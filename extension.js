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

export default class ForgeExtension extends Extension {
  enable() {
    this.settings = this.getSettings();
    this.kbdSettings = this.getSettings("org.gnome.shell.extensions.forge.keybindings");
    Logger.init(this.settings);
    Logger.info("enable");

    // Disable GNOME features that conflict with Forge (#461, #288)
    try {
      this._mutterSettings = new Gio.Settings({ schema_id: "org.gnome.mutter" });

      // Disable edge-tiling (#461)
      this._originalEdgeTiling = this._mutterSettings.get_boolean("edge-tiling");
      this._mutterSettings.set_boolean("edge-tiling", false);
      Logger.info("Disabled GNOME edge-tiling");

      // Disable auto-maximize (#288)
      this._originalAutoMaximize = this._mutterSettings.get_boolean("auto-maximize");
      this._mutterSettings.set_boolean("auto-maximize", false);
      Logger.info("Disabled GNOME auto-maximize");
    } catch (e) {
      Logger.warn(`Failed to disable GNOME conflicting features: ${e}`);
    }

    // Disable GNOME keybindings that conflict with Forge
    try {
      this._mutterKeybindings = new Gio.Settings({ schema_id: "org.gnome.mutter.keybindings" });
      this._wmKeybindings = new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings" });
      this._shellKeybindings = new Gio.Settings({ schema_id: "org.gnome.shell.keybindings" });

      // Save originals and disable
      this._originalToggleTiledLeft = this._mutterKeybindings.get_strv("toggle-tiled-left");
      this._mutterKeybindings.set_strv("toggle-tiled-left", []);

      this._originalToggleTiledRight = this._mutterKeybindings.get_strv("toggle-tiled-right");
      this._mutterKeybindings.set_strv("toggle-tiled-right", []);

      this._originalMaximize = this._wmKeybindings.get_strv("maximize");
      this._wmKeybindings.set_strv("maximize", []);

      this._originalUnmaximize = this._wmKeybindings.get_strv("unmaximize");
      this._wmKeybindings.set_strv("unmaximize", []);

      // Super+H conflicts with window-focus-left
      this._originalMinimize = this._wmKeybindings.get_strv("minimize");
      this._wmKeybindings.set_strv("minimize", []);

      // Super+V conflicts with con-split-vertical
      this._originalToggleMessageTray = this._shellKeybindings.get_strv("toggle-message-tray");
      this._shellKeybindings.set_strv("toggle-message-tray", []);

      Logger.info("Disabled conflicting GNOME keybindings");
    } catch (e) {
      Logger.warn(`Failed to disable GNOME keybindings: ${e}`);
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

    // Restore GNOME settings (#461, #288)
    if (this._mutterSettings) {
      try {
        if (this._originalEdgeTiling !== undefined) {
          this._mutterSettings.set_boolean("edge-tiling", this._originalEdgeTiling);
          Logger.info("Restored GNOME edge-tiling setting");
        }
        if (this._originalAutoMaximize !== undefined) {
          this._mutterSettings.set_boolean("auto-maximize", this._originalAutoMaximize);
          Logger.info("Restored GNOME auto-maximize setting");
        }
      } catch (e) {
        Logger.warn(`Failed to restore GNOME settings: ${e}`);
      }
      this._mutterSettings = null;
      this._originalEdgeTiling = undefined;
      this._originalAutoMaximize = undefined;
    }

    // Restore GNOME keybindings
    if (this._mutterKeybindings) {
      try {
        if (this._originalToggleTiledLeft !== undefined) {
          this._mutterKeybindings.set_strv("toggle-tiled-left", this._originalToggleTiledLeft);
        }
        if (this._originalToggleTiledRight !== undefined) {
          this._mutterKeybindings.set_strv("toggle-tiled-right", this._originalToggleTiledRight);
        }
        Logger.info("Restored GNOME mutter keybindings");
      } catch (e) {
        Logger.warn(`Failed to restore mutter keybindings: ${e}`);
      }
      this._mutterKeybindings = null;
      this._originalToggleTiledLeft = undefined;
      this._originalToggleTiledRight = undefined;
    }

    if (this._wmKeybindings) {
      try {
        if (this._originalMaximize !== undefined) {
          this._wmKeybindings.set_strv("maximize", this._originalMaximize);
        }
        if (this._originalUnmaximize !== undefined) {
          this._wmKeybindings.set_strv("unmaximize", this._originalUnmaximize);
        }
        if (this._originalMinimize !== undefined) {
          this._wmKeybindings.set_strv("minimize", this._originalMinimize);
        }
        Logger.info("Restored GNOME wm keybindings");
      } catch (e) {
        Logger.warn(`Failed to restore wm keybindings: ${e}`);
      }
      this._wmKeybindings = null;
      this._originalMaximize = undefined;
      this._originalUnmaximize = undefined;
      this._originalMinimize = undefined;
    }

    if (this._shellKeybindings) {
      try {
        if (this._originalToggleMessageTray !== undefined) {
          this._shellKeybindings.set_strv("toggle-message-tray", this._originalToggleMessageTray);
        }
        Logger.info("Restored GNOME shell keybindings");
      } catch (e) {
        Logger.warn(`Failed to restore shell keybindings: ${e}`);
      }
      this._shellKeybindings = null;
      this._originalToggleMessageTray = undefined;
    }

    this._removeIndicator();
    this.extWm?.disable();
    this.keybindings?.disable();
    this.cheatsheet?.destroy();
    this.configSync?.destroy();
    this.keybindings = null;
    this.cheatsheet = null;
    this.extWm = null;
    this.themeWm = null;
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
    this.indicator ??= new FeatureIndicator(this);
    this.indicator.quickSettingsItems.push(new FeatureMenuToggle(this));
    Main.panel.statusArea.quickSettings.addExternalIndicator(this.indicator);
  }

  _removeIndicator() {
    this.indicator?.quickSettingsItems.forEach((item) => item.destroy());
    this.indicator?.destroy();
    this.indicator = null;
  }
}
