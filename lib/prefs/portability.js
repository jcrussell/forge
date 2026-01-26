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
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

// Extension imports
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Shared state
import { ConfigManager } from "../shared/settings.js";
import { ConfigSync } from "../shared/config-sync.js";
import { Logger } from "../shared/logger.js";

// Prefs UI
import { PreferencesPage, SwitchRow } from "./widgets.js";

/**
 * Format a Unix timestamp as a human-readable date string
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string}
 */
function formatTimestamp(timestamp) {
  if (!timestamp || timestamp === 0) {
    return _("Never");
  }
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

/**
 * Action row with a button suffix
 */
class ButtonRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  constructor({ title, subtitle = "", buttonLabel, buttonStyle = [], onClicked }) {
    super({ title, subtitle });
    const button = new Gtk.Button({
      label: buttonLabel,
      valign: Gtk.Align.CENTER,
      css_classes: buttonStyle,
    });
    button.connect("clicked", onClicked);
    this.add_suffix(button);
    this.activatable_widget = button;
  }
}

/**
 * Info row showing a label and value
 */
class InfoRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  _valueLabel;

  constructor({ title, value, subtitle = "", selectable = false }) {
    super({ title, subtitle });
    this._valueLabel = new Gtk.Label({
      label: value,
      css_classes: ["dim-label"],
      valign: Gtk.Align.CENTER,
      selectable,
      ellipsize: 3, // Pango.EllipsizeMode.END
      max_width_chars: 40,
    });
    this.add_suffix(this._valueLabel);
  }

  set value(val) {
    this._valueLabel.label = val;
  }

  get value() {
    return this._valueLabel.label;
  }
}

export class PortabilityPage extends PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  _lastImportRow;
  _lastExportRow;
  _settingsStatusRow;
  _keybindingsStatusRow;

  constructor({ settings, kbdSettings, dir, window }) {
    super({ title: _("Portability"), icon_name: "folder-download-symbolic" });

    this._settings = settings;
    this._kbdSettings = kbdSettings;
    this._configMgr = new ConfigManager({ dir });
    this._window = window;

    // Create a ConfigSync instance for prefs (without auto-sync signals)
    this._configSync = new ConfigSync({
      configMgr: this._configMgr,
      settings: this._settings,
      kbdSettings: this._kbdSettings,
    });

    this._buildUI();
    this._updateStatus();

    // Listen for settings changes to update status
    this._settingsChangedId = this._settings.connect("changed", () => {
      this._updateStatus();
    });
  }

  _buildUI() {
    const configDir = this._configMgr.confDir;

    // Overview group
    this.add_group({
      title: _("Portable Configuration"),
      description: _(
        "Export your settings and keybindings to JSON files for backup or syncing across machines. " +
          "Files are stored in ~/.config/forge/config/"
      ),
      children: [
        new InfoRow({
          title: _("Config directory"),
          value: configDir,
          selectable: true,
        }),
        new ButtonRow({
          title: _("Open config directory"),
          subtitle: _("Open the configuration folder in your file manager"),
          buttonLabel: _("Open"),
          onClicked: () => this._openConfigDir(),
        }),
      ],
    });

    // Status group
    this._settingsStatusRow = new InfoRow({
      title: _("settings.json"),
      value: _("Checking..."),
    });

    this._keybindingsStatusRow = new InfoRow({
      title: _("keybindings.json"),
      value: _("Checking..."),
    });

    this._lastImportRow = new InfoRow({
      title: _("Last import"),
      value: _("Checking..."),
    });

    this._lastExportRow = new InfoRow({
      title: _("Last export"),
      value: _("Checking..."),
    });

    this.add_group({
      title: _("Status"),
      description: _("Current state of portable configuration files"),
      children: [
        this._settingsStatusRow,
        this._keybindingsStatusRow,
        this._lastImportRow,
        this._lastExportRow,
      ],
    });

    // Actions group
    this.add_group({
      title: _("Actions"),
      description: _("Export or import your configuration"),
      children: [
        new ButtonRow({
          title: _("Export current settings"),
          subtitle: _("Save all settings and keybindings to JSON files"),
          buttonLabel: _("Export"),
          buttonStyle: ["suggested-action"],
          onClicked: () => this._exportConfig(),
        }),
        new ButtonRow({
          title: _("Import from files"),
          subtitle: _("Load settings and keybindings from existing JSON files"),
          buttonLabel: _("Import"),
          onClicked: () => this._importConfig(),
        }),
        new SwitchRow({
          title: _("Auto-sync changes"),
          subtitle: _("Automatically update config files when settings change in Preferences"),
          settings: this._settings,
          bind: "config-file-sync-enabled",
        }),
      ],
    });

    // Help group
    this.add_group({
      title: _("How it works"),
      description: _(
        "1. Click 'Export' to create settings.json and keybindings.json files\n" +
          "2. Copy ~/.config/forge/config/ to your dotfiles or cloud storage\n" +
          "3. On a new machine, place the files and restart Forge to auto-import\n" +
          "4. Use Super+Shift+R to manually reload configuration at any time"
      ),
      children: [],
    });
  }

  _updateStatus() {
    // Check if files exist
    const settingsExists = this._configMgr.settingsConfigFile !== null;
    const keybindingsExists = this._configMgr.keybindingsConfigFile !== null;

    this._settingsStatusRow.value = settingsExists ? _("Present") : _("Not created");
    this._keybindingsStatusRow.value = keybindingsExists ? _("Present") : _("Not created");

    // Get timestamps
    const lastImport = this._settings.get_uint64("config-last-import");
    const lastExport = this._settings.get_uint64("config-last-export");

    this._lastImportRow.value = formatTimestamp(lastImport);
    this._lastExportRow.value = formatTimestamp(lastExport);
  }

  _openConfigDir() {
    const configDir = this._configMgr.confDir;

    // Ensure directory exists
    const dir = Gio.File.new_for_path(configDir);
    if (!dir.query_exists(null)) {
      try {
        dir.make_directory_with_parents(null);
      } catch (e) {
        Logger.error(`Failed to create config directory: ${e}`);
      }
    }

    // Open with default file manager
    try {
      const launcher = new Gtk.FileLauncher({
        file: dir,
      });
      launcher.launch(this._window, null, null);
    } catch (e) {
      // Fallback to xdg-open
      try {
        GLib.spawn_command_line_async(`xdg-open "${configDir}"`);
      } catch (e2) {
        Logger.error(`Failed to open config directory: ${e2}`);
        this._showToast(_("Failed to open config directory"));
      }
    }
  }

  _exportConfig() {
    try {
      this._configSync.exportAll();
      this._settings.set_boolean("config-file-sync-enabled", true);
      this._updateStatus();
      this._showToast(_("Configuration exported successfully"));
    } catch (e) {
      Logger.error(`Export failed: ${e}`);
      this._showToast(_("Export failed"));
    }
  }

  _importConfig() {
    const settingsExists = this._configMgr.settingsConfigFile !== null;
    const keybindingsExists = this._configMgr.keybindingsConfigFile !== null;

    if (!settingsExists && !keybindingsExists) {
      this._showToast(_("No config files found to import"));
      return;
    }

    try {
      this._configSync.importAll();
      this._updateStatus();
      this._showToast(_("Configuration imported successfully"));
    } catch (e) {
      Logger.error(`Import failed: ${e}`);
      this._showToast(_("Import failed"));
    }
  }

  _showToast(message) {
    if (this._window?.add_toast) {
      this._window.add_toast(new Adw.Toast({ title: message, timeout: 3 }));
    }
  }

  destroy() {
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    super.destroy?.();
  }
}
