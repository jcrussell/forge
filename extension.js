/*
 * This file is part of the Forge GNOME extension
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
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Gio from "gi://Gio";

// Shared state
import { Logger } from "./lib/shared/logger.js";
import { ConfigManager } from "./lib/shared/settings.js";
import { ConfigSync } from "./lib/shared/config-sync.js";

// Application imports
import { Cheatsheet } from "./lib/extension/cheatsheet.js";
import { Keybindings } from "./lib/extension/keybindings.js";
import { WindowManager } from "./lib/extension/window.js";
import { FeatureIndicator, FeatureMenuToggle } from "./lib/extension/indicator.js";
import { ExtensionThemeManager } from "./lib/extension/extension-theme-manager.js";

// Descriptors for GNOME settings that Forge overrides while enabled.
// Each entry saves the original value during enable() and restores it during disable().
const SETTINGS_OVERRIDES = [
  { schemaId: "org.gnome.mutter", key: "edge-tiling", type: "boolean", newValue: false },
  { schemaId: "org.gnome.mutter", key: "auto-maximize", type: "boolean", newValue: false },
  {
    schemaId: "org.gnome.mutter.keybindings",
    key: "toggle-tiled-left",
    type: "strv",
    newValue: [],
  },
  {
    schemaId: "org.gnome.mutter.keybindings",
    key: "toggle-tiled-right",
    type: "strv",
    newValue: [],
  },
  { schemaId: "org.gnome.desktop.wm.keybindings", key: "maximize", type: "strv", newValue: [] },
  { schemaId: "org.gnome.desktop.wm.keybindings", key: "unmaximize", type: "strv", newValue: [] },
  { schemaId: "org.gnome.desktop.wm.keybindings", key: "minimize", type: "strv", newValue: [] },
  {
    schemaId: "org.gnome.shell.keybindings",
    key: "toggle-message-tray",
    type: "strv",
    newValue: [],
  },
  // forge-m37 (#249): free GNOME's native Super+L lock so it doesn't collide with
  // Forge's vim window-focus-right (<Super>l). Forge provides locking via
  // prefs-lock-screen (<Super>q). Restored on disable() like the others; kept last
  // so a missing media-keys schema can't abort the overrides above.
  {
    schemaId: "org.gnome.settings-daemon.plugins.media-keys",
    key: "screensaver",
    type: "strv",
    newValue: [],
  },
];

export default class ForgeExtension extends Extension {
  enable() {
    this.settings = this.getSettings();
    this.kbdSettings = this.getSettings("org.gnome.shell.extensions.forge.keybindings");
    Logger.init(this.settings);
    Logger.info("enable");

    // Disable GNOME features and keybindings that conflict with Forge (#461, #288)
    this._savedSettings = [];
    this._gnomeSettings = new Map();
    try {
      for (const desc of SETTINGS_OVERRIDES) {
        if (!this._gnomeSettings.has(desc.schemaId)) {
          this._gnomeSettings.set(desc.schemaId, new Gio.Settings({ schema_id: desc.schemaId }));
        }
        const gsettings = this._gnomeSettings.get(desc.schemaId);
        const getter = desc.type === "boolean" ? "get_boolean" : "get_strv";
        const setter = desc.type === "boolean" ? "set_boolean" : "set_strv";
        const original = gsettings[getter](desc.key);
        gsettings[setter](desc.key, desc.newValue);
        this._savedSettings.push({ gsettings, key: desc.key, original, setter });
      }
      Logger.info("Disabled conflicting GNOME settings and keybindings");
    } catch (e) {
      Logger.warn(`Failed to disable GNOME conflicting features: ${e}`);
    }

    this.configMgr = new ConfigManager(this);

    // Initialize config sync - imports from files if they exist
    this.configSync = new ConfigSync({
      configMgr: this.configMgr,
      settings: this.settings,
      kbdSettings: this.kbdSettings,
    });
    this.configSync.init();

    this.theme = new ExtensionThemeManager(this);
    this.extWm = new WindowManager(this);
    this.keybindings = new Keybindings(this);
    this.cheatsheet = new Cheatsheet(this);
    this.keybindings.cheatsheet = this.cheatsheet;

    this._onSessionModeChanged(Main.sessionMode);
    this._sessionId = Main.sessionMode.connect("updated", this._onSessionModeChanged.bind(this));

    this.theme.patchCss();
    this.theme.reloadStylesheet();
    this.extWm.enable();
    Logger.info(`enable: finalized vars`);
  }

  disable() {
    Logger.info("disable");

    // See session mode unlock-dialog explanation on _onSessionModeChanged()
    if (this._sessionId) {
      Main.sessionMode.disconnect(this._sessionId);
      this._sessionId = null;
    }

    // Restore GNOME settings and keybindings (#461, #288)
    if (this._savedSettings) {
      try {
        for (const saved of this._savedSettings) {
          saved.gsettings[saved.setter](saved.key, saved.original);
        }
        Logger.info("Restored GNOME settings and keybindings");
      } catch (e) {
        Logger.warn(`Failed to restore GNOME settings: ${e}`);
      }
      this._savedSettings = null;
      this._gnomeSettings = null;
    }

    this._removeIndicator();
    this.extWm?.disable();
    this.keybindings?.disable();
    this.cheatsheet?.destroy();
    this.configSync?.destroy();
    this.keybindings = null;
    this.cheatsheet = null;
    this.extWm = null;
    this.theme = null;
    this.configMgr = null;
    this.configSync = null;
    this.settings = null;
    this.kbdSettings = null;
  }

  _onSessionModeChanged(session) {
    if (session.currentMode === "user" || session.parentMode === "user") {
      Logger.info("user on session change");
      this._addIndicator();
      this.keybindings?.enable();
    } else if (session.currentMode === "unlock-dialog") {
      // To the reviewer and maintainer: this extension needs to persist the window data structure in memory so it has to keep running on lock screen.
      // This is previous feature but was removed during GNOME 45 update due to the session-mode rule review.
      // The argument is that users will keep re-arranging windows when it times out or locks up.
      // Intent to serialize/deserialize to disk but that will take a longer time or probably a longer argument during review.
      // To keep following, added to only disable keybindings() and re-enable them during user session.
      // https://gjs.guide/extensions/review-guidelines/review-guidelines.html#session-modes
      Logger.info("lock-screen on session change");
      this.keybindings?.disable();
      this._removeIndicator();
    }
  }

  _addIndicator() {
    // Bug #354: repeated "user" session updates must not stack duplicate
    // menu toggles; _removeIndicator nulls this.indicator on lock.
    if (this.indicator) return;
    this.indicator = new FeatureIndicator(this);
    this.indicator.quickSettingsItems.push(new FeatureMenuToggle(this));
    Main.panel.statusArea.quickSettings.addExternalIndicator(this.indicator);
  }

  _removeIndicator() {
    this.indicator?.quickSettingsItems.forEach((item) => item.destroy());
    this.indicator?.destroy();
    this.indicator = null;
  }
}
