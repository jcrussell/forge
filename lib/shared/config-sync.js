/*
 * This file is part of the Forge extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// Gnome imports
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import { Logger } from "./logger.js";

// Settings keys that should be synced to settings.json
const SETTINGS_KEYS = {
  behavior: [
    "tiling-mode-enabled",
    "focus-on-hover-enabled",
    "move-pointer-focus-enabled",
    "auto-split-enabled",
    "stacked-tiling-mode-enabled",
    "tabbed-tiling-mode-enabled",
    "auto-exit-tabbed",
    "default-window-layout",
    "dnd-center-layout",
    "float-always-on-top-enabled",
    "auto-unmaximize-for-tiling",
    "focus-on-hover-tiling-only",
  ],
  appearance: [
    "focus-border-toggle",
    "focus-border-size",
    "focus-border-color",
    "focus-border-radius",
    "split-border-toggle",
    "split-border-color",
    "window-gap-size",
    "window-gap-size-increment",
    "window-gap-hidden-on-single",
    "window-maximize-on-single",
    "focus-border-hidden-on-single",
    "window-margin-top",
    "window-margin-bottom",
    "window-margin-left",
    "window-margin-right",
    "preview-hint-enabled",
    "showtab-decoration-enabled",
    "tabbed-tab-margin",
    "quick-settings-enabled",
    "tray-icon-enabled",
  ],
  workspaces: ["workspace-skip-tile", "monitor-skip-tile"],
  development: ["log-level", "logging-enabled"],
  other: ["primary-layout-mode", "resize-amount", "launch-app-command"],
};

// Keybinding keys that should be synced
const KEYBINDING_KEYS = [
  "focus-border-toggle",
  "window-gap-size-increase",
  "window-gap-size-decrease",
  "con-split-layout-toggle",
  "con-split-horizontal",
  "con-split-vertical",
  "con-stacked-layout-toggle",
  "con-tabbed-layout-toggle",
  "con-tabbed-showtab-decoration-toggle",
  "window-swap-left",
  "window-swap-down",
  "window-swap-up",
  "window-swap-right",
  "window-move-left",
  "window-move-down",
  "window-move-up",
  "window-move-right",
  "window-focus-left",
  "window-focus-down",
  "window-focus-up",
  "window-focus-right",
  "window-toggle-float",
  "window-toggle-always-float",
  "workspace-active-tile-toggle",
  "prefs-open",
  "prefs-tiling-toggle",
  "window-swap-last-active",
  "window-snap-one-third-right",
  "window-snap-two-third-right",
  "window-snap-one-third-left",
  "window-snap-two-third-left",
  "window-snap-center",
  "window-resize-left-increase",
  "window-resize-left-decrease",
  "window-resize-bottom-increase",
  "window-resize-bottom-decrease",
  "window-resize-top-increase",
  "window-resize-top-decrease",
  "window-resize-right-increase",
  "window-resize-right-decrease",
  "window-reset-sizes",
  "prefs-config-reload",
  "prefs-config-export",
  "window-pointer-to-focus",
  "workspace-monocle-toggle",
  "window-expand",
  "window-shrink",
  "prefs-app-launch",
  "prefs-cheatsheet-toggle",
  "prefs-lock-screen",
];

// The mod-mask-mouse-tile key is a string, not an array
const KEYBINDING_STRING_KEYS = ["mod-mask-mouse-tile"];

/**
 * ConfigSync handles bidirectional sync between GSettings and JSON config files.
 * Files are only created on explicit export; if files exist on startup, they are imported.
 */
export class ConfigSync extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /** @type {boolean} Whether config files were loaded on startup */
  configFilesLoaded = false;

  /** @type {number|null} Debounce timeout ID for auto-export */
  _exportDebounceId = null;

  /** @type {number} Debounce delay in milliseconds */
  static DEBOUNCE_MS = 500;

  /**
   * @param {Object} params
   * @param {import('./settings.js').ConfigManager} params.configMgr
   * @param {Gio.Settings} params.settings
   * @param {Gio.Settings} params.kbdSettings
   */
  constructor({ configMgr, settings, kbdSettings }) {
    super();
    this._configMgr = configMgr;
    this._settings = settings;
    this._kbdSettings = kbdSettings;
    this._settingsSignalIds = [];
    this._kbdSettingsSignalIds = [];
  }

  /**
   * Initialize the config sync system.
   * If config files exist, import them and enable auto-sync.
   */
  init() {
    if (this._configMgr.hasPortableConfig()) {
      Logger.info("Portable config files found, importing...");
      this.importAll();
      this.configFilesLoaded = true;
      this._settings.set_boolean("config-file-sync-enabled", true);
    } else {
      // Check if sync was previously enabled (user may have deleted files)
      this.configFilesLoaded = this._settings.get_boolean("config-file-sync-enabled");
    }

    if (this.configFilesLoaded) {
      this._connectSettingsSignals();
    }

    Logger.info(`ConfigSync initialized, configFilesLoaded: ${this.configFilesLoaded}`);
  }

  /**
   * Clean up signal connections
   */
  destroy() {
    this._disconnectSettingsSignals();
    if (this._exportDebounceId) {
      GLib.source_remove(this._exportDebounceId);
      this._exportDebounceId = null;
    }
  }

  /**
   * Connect to GSettings changed signals for auto-export
   */
  _connectSettingsSignals() {
    // Connect to main settings changes
    const settingsId = this._settings.connect("changed", (settings, key) => {
      this._onSettingsChanged(key, false);
    });
    this._settingsSignalIds.push(settingsId);

    // Connect to keybindings settings changes
    const kbdId = this._kbdSettings.connect("changed", (settings, key) => {
      this._onSettingsChanged(key, true);
    });
    this._kbdSettingsSignalIds.push(kbdId);
  }

  /**
   * Disconnect all signal connections
   */
  _disconnectSettingsSignals() {
    for (const id of this._settingsSignalIds) {
      this._settings.disconnect(id);
    }
    this._settingsSignalIds = [];

    for (const id of this._kbdSettingsSignalIds) {
      this._kbdSettings.disconnect(id);
    }
    this._kbdSettingsSignalIds = [];
  }

  /**
   * Handle settings changes - debounce and export if sync is enabled
   * @param {string} key
   * @param {boolean} isKeybinding
   */
  _onSettingsChanged(key, isKeybinding) {
    // Skip internal tracking keys
    if (
      key === "config-last-import" ||
      key === "config-last-export" ||
      key === "config-file-sync-enabled" ||
      key === "css-updated" ||
      key === "css-last-update" ||
      key === "window-overrides-reload-trigger"
    ) {
      return;
    }

    if (!this.configFilesLoaded) {
      return;
    }

    // Debounce exports to batch rapid changes
    if (this._exportDebounceId) {
      GLib.source_remove(this._exportDebounceId);
    }

    this._exportDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ConfigSync.DEBOUNCE_MS, () => {
      this.exportAll();
      this._exportDebounceId = null;
      return GLib.SOURCE_REMOVE;
    });
  }

  /**
   * Import settings for a category from props into GSettings
   * @param {Object} props - The props object containing settings
   * @param {string} category - The category name (e.g., 'behavior', 'appearance')
   */
  _importSettingsCategory(props, category) {
    if (props[category]) {
      for (const key of SETTINGS_KEYS[category]) {
        if (props[category][key] !== undefined) {
          this._setSettingValue(key, props[category][key]);
        }
      }
    }
  }

  /**
   * Export settings for a category from GSettings to props object
   * @param {Object} props - The props object to export to
   * @param {string} category - The category name (e.g., 'behavior', 'appearance')
   */
  _exportSettingsCategory(props, category) {
    for (const key of SETTINGS_KEYS[category]) {
      props[category][key] = this._getSettingValue(key);
    }
  }

  /**
   * Import settings from settings.json into GSettings
   * @returns {boolean} Whether import was successful
   */
  importSettings() {
    const props = this._configMgr.settingsProps;
    if (!props) {
      Logger.debug("No settings.json found, skipping import");
      return false;
    }

    try {
      this._importSettingsCategory(props, "behavior");
      this._importSettingsCategory(props, "appearance");
      this._importSettingsCategory(props, "workspaces");
      this._importSettingsCategory(props, "development");
      this._importSettingsCategory(props, "other");

      this._settings.set_uint64("config-last-import", Math.floor(Date.now() / 1000));
      Logger.info("Settings imported from settings.json");
      return true;
    } catch (e) {
      Logger.error(`Failed to import settings: ${e}`);
      return false;
    }
  }

  /**
   * Import keybindings from keybindings.json into GSettings
   * @returns {boolean} Whether import was successful
   */
  importKeybindings() {
    const props = this._configMgr.keybindingsProps;
    if (!props) {
      Logger.debug("No keybindings.json found, skipping import");
      return false;
    }

    try {
      // Import mod-mask-mouse-tile
      if (props["mod-mask-mouse-tile"] !== undefined) {
        this._kbdSettings.set_string("mod-mask-mouse-tile", props["mod-mask-mouse-tile"]);
      }

      // Import bindings
      if (props.bindings) {
        for (const key of KEYBINDING_KEYS) {
          if (props.bindings[key] !== undefined) {
            const value = props.bindings[key];
            if (Array.isArray(value)) {
              this._kbdSettings.set_strv(key, value);
            }
          }
        }
      }

      this._settings.set_uint64("config-last-import", Math.floor(Date.now() / 1000));
      Logger.info("Keybindings imported from keybindings.json");
      return true;
    } catch (e) {
      Logger.error(`Failed to import keybindings: ${e}`);
      return false;
    }
  }

  /**
   * Import all config files
   */
  importAll() {
    this.importSettings();
    this.importKeybindings();
  }

  /**
   * Export settings from GSettings to settings.json
   * @returns {boolean} Whether export was successful
   */
  exportSettings() {
    try {
      const props = {
        $schema: `file://${this._configMgr.extensionPath}/config/settings.schema.json`,
        version: 1,
        behavior: {},
        appearance: {},
        workspaces: {},
        development: {},
        other: {},
      };

      this._exportSettingsCategory(props, "behavior");
      this._exportSettingsCategory(props, "appearance");
      this._exportSettingsCategory(props, "workspaces");
      this._exportSettingsCategory(props, "development");
      this._exportSettingsCategory(props, "other");

      this._configMgr.settingsProps = props;
      this._settings.set_uint64("config-last-export", Math.floor(Date.now() / 1000));
      Logger.info("Settings exported to settings.json");
      return true;
    } catch (e) {
      Logger.error(`Failed to export settings: ${e}`);
      return false;
    }
  }

  /**
   * Export keybindings from GSettings to keybindings.json
   * @returns {boolean} Whether export was successful
   */
  exportKeybindings() {
    try {
      const props = {
        $schema: `file://${this._configMgr.extensionPath}/config/keybindings.schema.json`,
        version: 1,
        "mod-mask-mouse-tile": this._kbdSettings.get_string("mod-mask-mouse-tile"),
        bindings: {},
      };

      // Export all keybindings
      for (const key of KEYBINDING_KEYS) {
        props.bindings[key] = this._kbdSettings.get_strv(key);
      }

      this._configMgr.keybindingsProps = props;
      this._settings.set_uint64("config-last-export", Math.floor(Date.now() / 1000));
      Logger.info("Keybindings exported to keybindings.json");
      return true;
    } catch (e) {
      Logger.error(`Failed to export keybindings: ${e}`);
      return false;
    }
  }

  /**
   * Export all settings and keybindings to config files
   */
  exportAll() {
    this.exportSettings();
    this.exportKeybindings();
  }

  /**
   * Manually trigger export and enable sync
   * This is called when user explicitly requests export
   */
  enablePortableConfig() {
    this.exportAll();
    this.configFilesLoaded = true;
    this._settings.set_boolean("config-file-sync-enabled", true);

    if (this._settingsSignalIds.length === 0) {
      this._connectSettingsSignals();
    }

    Logger.info("Portable config enabled and exported");
  }

  /**
   * Get a setting value from GSettings based on its type
   * @param {string} key
   * @returns {any}
   */
  _getSettingValue(key) {
    const variant = this._settings.get_value(key);
    const typeString = variant.get_type_string();

    switch (typeString) {
      case "b":
        return this._settings.get_boolean(key);
      case "u":
        return this._settings.get_uint(key);
      case "i":
        return this._settings.get_int(key);
      case "s":
        return this._settings.get_string(key);
      case "d":
        return this._settings.get_double(key);
      case "as":
        return this._settings.get_strv(key);
      default:
        Logger.warn(`Unknown setting type for ${key}: ${typeString}`);
        return null;
    }
  }

  /**
   * Set a setting value in GSettings based on its type
   * @param {string} key
   * @param {any} value
   */
  _setSettingValue(key, value) {
    const variant = this._settings.get_value(key);
    const typeString = variant.get_type_string();

    switch (typeString) {
      case "b":
        this._settings.set_boolean(key, value);
        break;
      case "u":
        this._settings.set_uint(key, value);
        break;
      case "i":
        this._settings.set_int(key, value);
        break;
      case "s":
        this._settings.set_string(key, value);
        break;
      case "d":
        this._settings.set_double(key, value);
        break;
      case "as":
        this._settings.set_strv(key, value);
        break;
      default:
        Logger.warn(`Unknown setting type for ${key}: ${typeString}`);
    }
  }
}
