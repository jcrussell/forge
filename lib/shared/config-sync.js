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
    "auto-reorient-on-close",
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

// GSettings type string → getter/setter method names
const SETTINGS_TYPE_MAP = {
  b: { get: "get_boolean", set: "set_boolean" },
  u: { get: "get_uint", set: "set_uint" },
  i: { get: "get_int", set: "set_int" },
  s: { get: "get_string", set: "set_string" },
  d: { get: "get_double", set: "set_double" },
  as: { get: "get_strv", set: "set_strv" },
};

/**
 * ConfigSync handles bidirectional sync between GSettings and JSON config files.
 * Files are only created on explicit export; if files exist on startup, they are imported.
 */
// Category names derived from SETTINGS_KEYS for DRY iteration
const SETTINGS_CATEGORIES = Object.keys(SETTINGS_KEYS);

export class ConfigSync extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /** @type {boolean} Whether config files were loaded on startup */
  configFilesLoaded = false;

  /** @type {boolean} True while importAll() is applying file values to GSettings */
  _importing = false;

  /** @type {number|null} Idle source ID that clears _importing after import drains */
  _importClearId = null;

  /** @type {number|null} Debounce timeout ID for auto-export */
  _exportDebounceId = null;

  /**
   * @type {{settings: number|null, keybindings: number|null}}
   * On-disk mtime of each config file as of our last write. The debounced
   * auto-export compares against these to skip writes that would clobber an
   * out-of-band change — a prefs Export/Import or a hand edit (forge-nn0m).
   * null means "no baseline yet", which never blocks.
   */
  _lastWrittenMtimes = { settings: null, keybindings: null };

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
    }

    // Respect the user's stored choice instead of force-enabling sync whenever
    // files exist (forge-orrf). The key only flips to true via an explicit Export
    // (enablePortableConfig); a user who turned it off stays off across restarts.
    this.configFilesLoaded = this._settings.get_boolean("config-file-sync-enabled");

    // Always listen so the "Auto-sync changes" toggle is honored at runtime
    // (forge-el01); auto-export stays gated on configFilesLoaded in the handler.
    this._connectSettingsSignals();

    // Seed the clobber-guard baseline from the files on disk so the first
    // post-startup auto-export already detects out-of-band writes (forge-nn0m).
    this._recordWrittenMtimes();

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
    if (this._importClearId) {
      GLib.source_remove(this._importClearId);
      this._importClearId = null;
    }
  }

  /**
   * Build a file:// URL to a schema in the extension's config directory
   * @param {string} name - Schema name without extension (e.g., "settings", "keybindings")
   * @returns {string}
   */
  _schemaUrl(name) {
    return `file://${this._configMgr.extensionPath}/config/${name}.schema.json`;
  }

  /**
   * Connect to GSettings changed signals for auto-export
   */
  _connectSettingsSignals() {
    const settingsId = this._settings.connect("changed", (settings, key) => {
      this._onSettingsChanged(key, false);
    });
    this._settingsSignalIds.push(settingsId);

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
    // React to the "Auto-sync changes" toggle at runtime (forge-el01). The key
    // lives only on the main settings schema, so always read it from _settings.
    if (key === "config-file-sync-enabled") {
      this.configFilesLoaded = this._settings.get_boolean(key);
      return;
    }

    // Drop changes the import path itself is making (forge-3t3a) — otherwise the
    // per-key set_* calls would schedule an export that rewrites the file we just
    // imported.
    if (this._importing) {
      return;
    }

    // Skip internal tracking keys
    if (
      key === "config-last-import" ||
      key === "config-last-export" ||
      key === "css-updated" ||
      key === "css-last-update" ||
      key === "window-overrides-reload-trigger"
    ) {
      return;
    }

    if (!this.configFilesLoaded) {
      return;
    }

    // Don't resurrect portable files the user deleted (forge-qj5n). If neither
    // file exists, an ordinary settings change must not recreate them — only an
    // explicit Export / enablePortableConfig may (re)create deleted files.
    if (!this._configMgr.hasPortableConfig()) {
      return;
    }

    // Debounce exports to batch rapid changes
    if (this._exportDebounceId) {
      GLib.source_remove(this._exportDebounceId);
    }

    this._exportDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ConfigSync.DEBOUNCE_MS, () => {
      this._exportDebounceId = null;
      // Don't let a background auto-export clobber a file another writer changed
      // since our last write (forge-nn0m). User-initiated Export/Import bypass
      // this path and always win.
      if (!this._configChangedExternally()) {
        this._autoExport();
      } else {
        // Adopt the external writer's file as our new baseline so we skip only
        // THIS stale export — the next genuine change exports normally instead
        // of latching auto-export off until restart.
        this._recordWrittenMtimes();
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  /**
   * Record the on-disk mtime of each config file as our new baseline. Called
   * after every write so subsequent auto-exports compare against what we left.
   */
  _recordWrittenMtimes() {
    this._lastWrittenMtimes.settings = this._configMgr.getConfigMtime("settings");
    this._lastWrittenMtimes.keybindings = this._configMgr.getConfigMtime("keybindings");
  }

  /**
   * True when a config file changed on disk since our last write — i.e. another
   * writer (prefs Export/Import, a hand edit) touched it. A null baseline (we've
   * never written) never blocks. (forge-nn0m)
   * @returns {boolean}
   */
  _configChangedExternally() {
    for (const name of ["settings", "keybindings"]) {
      const baseline = this._lastWrittenMtimes[name];
      if (baseline == null) continue;
      const current = this._configMgr.getConfigMtime(name);
      if (current != null && current !== baseline) {
        Logger.warn(
          `${name}.json changed outside the extension; skipping auto-export to avoid clobbering it (use Export to overwrite)`
        );
        return true;
      }
    }
    return false;
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
      for (const category of SETTINGS_CATEGORIES) {
        this._importSettingsCategory(props, category);
      }

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
      if (props["mod-mask-mouse-tile"] !== undefined) {
        this._kbdSettings.set_string("mod-mask-mouse-tile", props["mod-mask-mouse-tile"]);
      }

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
    this._importing = true;
    this.importSettings();
    this.importKeybindings();
    // dconf delivers the "changed" notifications for the keys we just set on a
    // later main-loop turn, so the guard must survive past this synchronous
    // burst. Clear it on a low-priority idle that runs AFTER those notifications
    // have been dispatched (forge-3t3a).
    if (this._importClearId) {
      GLib.source_remove(this._importClearId);
    }
    this._importClearId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._importing = false;
      this._importClearId = null;
      return GLib.SOURCE_REMOVE;
    });
  }

  /**
   * Export settings from GSettings to settings.json
   * @returns {boolean} Whether export was successful
   */
  exportSettings() {
    try {
      const props = {
        $schema: this._schemaUrl("settings"),
        version: 1,
      };
      for (const category of SETTINGS_CATEGORIES) {
        props[category] = {};
        this._exportSettingsCategory(props, category);
      }

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
        $schema: this._schemaUrl("keybindings"),
        version: 1,
        "mod-mask-mouse-tile": this._kbdSettings.get_string("mod-mask-mouse-tile"),
        bindings: {},
      };

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
    this._recordWrittenMtimes();
  }

  /**
   * Background auto-export (the debounced settings-changed path). Unlike the
   * explicit exportAll(), this only (re)writes a portable file that CURRENTLY
   * exists — re-checking per file at fire time. So a file the user deleted is
   * not resurrected by an ordinary settings change (forge-rt10), while a partial
   * deletion still keeps the surviving file in sync. Explicit Export /
   * enablePortableConfig deliberately still (re)create both (forge-qj5n).
   */
  _autoExport() {
    if (this._configMgr.settingsConfigFile !== null) this.exportSettings();
    if (this._configMgr.keybindingsConfigFile !== null) this.exportKeybindings();
    this._recordWrittenMtimes();
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
    const typeString = this._settings.get_value(key).get_type_string();
    const entry = SETTINGS_TYPE_MAP[typeString];
    if (entry) return this._settings[entry.get](key);
    Logger.warn(`Unknown setting type for ${key}: ${typeString}`);
    return null;
  }

  /**
   * Set a setting value in GSettings based on its type
   * @param {string} key
   * @param {any} value
   */
  _setSettingValue(key, value) {
    const typeString = this._settings.get_value(key).get_type_string();
    const entry = SETTINGS_TYPE_MAP[typeString];
    if (entry) return this._settings[entry.set](key, value);
    Logger.warn(`Unknown setting type for ${key}: ${typeString}`);
  }
}
