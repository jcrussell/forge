import GObject from "gi://GObject";
import Gio from "gi://Gio";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { QuickMenuToggle, SystemIndicator } from "resource:///org/gnome/shell/ui/quickSettings.js";
import {
  PopupSwitchMenuItem,
  PopupSeparatorMenuItem,
} from "resource:///org/gnome/shell/ui/popupMenu.js";

import * as Utils from "./utils.js";
import { Logger } from "../shared/logger.js";

const iconName = "view-grid-symbolic";

/** @typedef {import('../../extension.js').default} ForgeExtension */

class SettingsPopupSwitch extends PopupSwitchMenuItem {
  static {
    GObject.registerClass(this);
  }

  /** @type {ForgeExtension} extension */
  extension;

  /** @type {number | null} */
  _settingsChangedId = null;

  /**
   * @param {string} title
   * @param {ForgeExtension} extension
   * @param {string} bind
   */
  constructor(title, extension, bind) {
    const settings = extension.settings;
    const active = !!settings?.get_boolean(bind);
    super(title, active);
    this.extension = extension;
    Logger.info(bind, active);
    // settings is null only while the extension is disabled; this item is never
    // constructed then, so there is nothing to wire up if it is absent.
    if (!settings) return;
    this.connect("toggled", (item) => settings.set_boolean(bind, item.state));
    // forge-4zl2: the switch snapshotted its value at construction and only wrote on
    // 'toggled', so an external change to the same key (the matching keybinding, or
    // prefs) left it stale until the menu was rebuilt on lock/unlock — and toggling
    // it was then a silent no-op write of the value it already held. Track the key
    // and sync the toggle. setToggleState() updates the switch WITHOUT re-emitting
    // 'toggled', so this doesn't loop back into set_boolean.
    this._settingsChangedId = settings.connect(`changed::${bind}`, () => {
      this.setToggleState(!!settings.get_boolean(bind));
    });
    this.connect("destroy", () => {
      if (this._settingsChangedId) {
        settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
      }
    });
  }
}

export class FeatureMenuToggle extends QuickMenuToggle {
  static {
    GObject.registerClass(this);
  }

  constructor(extension) {
    const title = _("Tiling");
    const initSettings = Utils.isGnomeGTE(45)
      ? { title, iconName, toggleMode: true }
      : { label: title, iconName, toggleMode: true };
    super(initSettings);
    this.extension = extension;
    this.extension.settings.bind(
      "tiling-mode-enabled",
      this,
      "checked",
      Gio.SettingsBindFlags.DEFAULT
    );
    this.extension.settings.bind(
      "quick-settings-enabled",
      this,
      "visible",
      Gio.SettingsBindFlags.DEFAULT
    );

    this.menu.setHeader(iconName, _("Forge"), _("Tiling Window Management"));

    this.menu.addMenuItem(
      (this._singleSwitch = new SettingsPopupSwitch(
        _("Gaps Hidden when Single"),
        this.extension,
        "window-gap-hidden-on-single"
      ))
    );

    this.menu.addMenuItem(
      (this._focusHintSwitch = new SettingsPopupSwitch(
        _("Show Focus Hint Border"),
        this.extension,
        "focus-border-toggle"
      ))
    );

    this.menu.addMenuItem(
      (this._focusMovePointer = new SettingsPopupSwitch(
        _("Move Pointer with the Focus"),
        this.extension,
        "move-pointer-focus-enabled"
      ))
    );

    this.menu.addMenuItem(new PopupSeparatorMenuItem());
    // addAction returns the created PopupMenuItem at runtime, but @girs types it as void.
    const settingsItem =
      /** @type {import('resource:///org/gnome/shell/ui/popupMenu.js').PopupMenuItem} */ (
        /** @type {unknown} */ (
          this.menu.addAction(_("Settings"), () => this.extension.openPreferences())
        )
      );

    // Ensure the settings are unavailable when the screen is locked
    settingsItem.visible = Main.sessionMode.allowSettings;
    // _settingsActions is a GNOME-internal registry on the quick-settings menu.
    /** @type {{ _settingsActions: Record<string, any> }} */ (
      /** @type {unknown} */ (this.menu)
    )._settingsActions[this.extension.uuid] = settingsItem;
  }
}

export class FeatureIndicator extends SystemIndicator {
  static {
    GObject.registerClass(this);
  }

  constructor(extension) {
    super();

    this.extension = extension;

    this._indicator = this._addIndicator();
    this._indicator.icon_name = iconName;

    const tilingModeEnabled = this.extension.settings.get_boolean("tiling-mode-enabled");
    const quickSettingsEnabled = this.extension.settings.get_boolean("quick-settings-enabled");
    const trayIconEnabled = this.extension.settings.get_boolean("tray-icon-enabled");

    // Feature #286: Tray icon requires both quick-settings-enabled (backwards compat) and tray-icon-enabled
    this._indicator.visible = tilingModeEnabled && quickSettingsEnabled && trayIconEnabled;

    // Store signal ID for cleanup to avoid "already disposed" errors
    this._settingsChangedId = this.extension.settings.connect("changed", (_, name) => {
      switch (name) {
        case "tiling-mode-enabled":
        case "quick-settings-enabled":
        case "tray-icon-enabled":
          if (
            this._indicator &&
            !(/** @type {{ _destroyed?: boolean }} */ (this._indicator)._destroyed)
          ) {
            const tiling = this.extension.settings.get_boolean("tiling-mode-enabled");
            const quick = this.extension.settings.get_boolean("quick-settings-enabled");
            const tray = this.extension.settings.get_boolean("tray-icon-enabled");
            this._indicator.visible = tiling && quick && tray;
          }
      }
    });
  }

  destroy() {
    // Disconnect the settings signal to prevent "already disposed" errors
    if (this._settingsChangedId) {
      this.extension.settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    super.destroy();
  }
}
