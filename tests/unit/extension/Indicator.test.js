import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// The quick-settings and popup-menu bases are GNOME Shell JS classes. These mocks
// keep the parts the indicator uses: St.Widget signals, a switch item whose
// setToggleState() updates state without emitting 'toggled' (like the real one),
// a menu that records its items, and a SystemIndicator that hands out an icon.
vi.mock("resource:///org/gnome/shell/ui/popupMenu.js", async () => {
  const St = (await import("gi://St")).default;
  class PopupSwitchMenuItem extends St.Widget {
    constructor(text, active) {
      super();
      this.label = text;
      this.state = active;
    }
    setToggleState(state) {
      this.state = state;
    }
    toggle() {
      this.state = !this.state;
      this.emit("toggled", this, this.state);
    }
  }
  class PopupSeparatorMenuItem extends St.Widget {}
  return { PopupSwitchMenuItem, PopupSeparatorMenuItem };
});

vi.mock("resource:///org/gnome/shell/ui/quickSettings.js", async () => {
  const St = (await import("gi://St")).default;
  class QuickMenuToggle extends St.Widget {
    constructor(params) {
      super();
      this.params = params;
      this.menu = {
        items: [],
        actions: [],
        _settingsActions: {},
        setHeader: vi.fn(),
        addMenuItem(item) {
          this.items.push(item);
        },
        addAction(label, callback) {
          const item = { label, callback, visible: true };
          this.actions.push(item);
          return item;
        },
      };
    }
  }
  class SystemIndicator extends St.Widget {
    _addIndicator() {
      return new St.Icon();
    }
  }
  return { QuickMenuToggle, SystemIndicator };
});

import { FeatureIndicator, FeatureMenuToggle } from "../../../lib/extension/indicator.js";

const TRAY_KEYS = ["tiling-mode-enabled", "quick-settings-enabled", "tray-icon-enabled"];

/** Set a key and emit the signals real Gio.Settings emits for a change. */
function change(settings, key, value) {
  settings.set_boolean(key, value);
  settings.emit(`changed::${key}`, settings, key);
  settings.emit("changed", settings, key);
}

describe("Indicator", () => {
  let settings;
  let extension;

  beforeEach(() => {
    settings = new Gio.Settings("org.gnome.shell.extensions.forge");
    settings.bind = vi.fn();
    extension = { settings, uuid: "forge@test", openPreferences: vi.fn() };
  });

  afterEach(() => {
    delete Main.sessionMode.allowSettings;
  });

  describe("FeatureMenuToggle", () => {
    let toggle;
    let switches;

    beforeEach(() => {
      settings.set_boolean("focus-border-toggle", true);
      toggle = new FeatureMenuToggle(extension);
      switches = toggle.menu.items.filter((item) => "state" in item);
    });

    it("binds the toggle's checked and visible state to settings", () => {
      expect(settings.bind).toHaveBeenCalledWith(
        "tiling-mode-enabled",
        toggle,
        "checked",
        expect.anything()
      );
      expect(settings.bind).toHaveBeenCalledWith(
        "quick-settings-enabled",
        toggle,
        "visible",
        expect.anything()
      );
    });

    it("builds a switch per setting, initialised from its key", () => {
      expect(switches.map((s) => s.label)).toEqual([
        "Gaps Hidden when Single",
        "Show Focus Hint Border",
        "Move Pointer with the Focus",
      ]);
      expect(switches.map((s) => s.state)).toEqual([false, true, false]);
    });

    it("writes the setting when a switch is toggled", () => {
      toggle._singleSwitch.toggle();
      expect(settings.get_boolean("window-gap-hidden-on-single")).toBe(true);
    });

    it("syncs a switch when its key changes elsewhere (forge-4zl2)", () => {
      change(settings, "focus-border-toggle", false);
      expect(toggle._focusHintSwitch.state).toBe(false);
      change(settings, "focus-border-toggle", true);
      expect(toggle._focusHintSwitch.state).toBe(true);
    });

    it("stops syncing a switch once it is destroyed", () => {
      const item = toggle._focusMovePointer;
      const setToggleState = vi.spyOn(item, "setToggleState");
      item.destroy();
      expect(settings.getHandlerCount("changed::move-pointer-focus-enabled")).toBe(0);
      change(settings, "move-pointer-focus-enabled", true);
      expect(setToggleState).not.toHaveBeenCalled();
      expect(item.state).toBe(false);
    });

    it("opens preferences from the Settings action", () => {
      const [action] = toggle.menu.actions;
      expect(toggle.menu._settingsActions["forge@test"]).toBe(action);
      action.callback();
      expect(extension.openPreferences).toHaveBeenCalled();
    });

    it("hides the Settings action when the session disallows settings", () => {
      Main.sessionMode.allowSettings = false;
      const locked = new FeatureMenuToggle(extension);
      expect(locked.menu.actions[0].visible).toBe(false);
    });
  });

  describe("FeatureIndicator", () => {
    beforeEach(() => {
      for (const key of TRAY_KEYS) settings.set_boolean(key, true);
    });

    it("shows the tray icon only when all three keys are on", () => {
      expect(new FeatureIndicator(extension)._indicator.visible).toBe(true);
      settings.set_boolean("tray-icon-enabled", false);
      expect(new FeatureIndicator(extension)._indicator.visible).toBe(false);
    });

    it.each(TRAY_KEYS)("follows a change to %s", (key) => {
      const indicator = new FeatureIndicator(extension);
      change(settings, key, false);
      expect(indicator._indicator.visible).toBe(false);
      change(settings, key, true);
      expect(indicator._indicator.visible).toBe(true);
    });

    it("ignores changes to other keys", () => {
      const indicator = new FeatureIndicator(extension);
      settings.set_boolean("tiling-mode-enabled", false);
      settings.emit("changed", settings, "focus-border-toggle");
      expect(indicator._indicator.visible).toBe(true);
    });

    it("disconnects from settings on destroy", () => {
      const indicator = new FeatureIndicator(extension);
      indicator.destroy();
      expect(settings.getHandlerCount("changed")).toBe(0);
      expect(() => change(settings, "tray-icon-enabled", false)).not.toThrow();
      expect(indicator._indicator.visible).toBe(true);
    });
  });
});
