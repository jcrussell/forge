import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keybindings } from "../../lib/extension/keybindings.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

vi.mock("../../lib/extension/indicator.js", () => ({
  FeatureIndicator: class FeatureIndicator {
    quickSettingsItems = [];
    destroy() {}
  },
  FeatureMenuToggle: vi.fn(function FeatureMenuToggle() {
    this.destroy = vi.fn();
  }),
}));

import ForgeExtension from "../../extension.js";
import { FeatureMenuToggle } from "../../lib/extension/indicator.js";

/**
 * Bug #354 regression: Main.sessionMode "updated" can re-emit with a "user"
 * mode while Forge is already enabled. _onSessionModeChanged then re-ran
 * keybindings.enable() (re-registering every binding -> Mutter logs
 * "Overwriting existing binding of keysym ...") and _addIndicator() pushed a
 * duplicate FeatureMenuToggle into the quick settings panel.
 */
describe("Bug #354: session-mode idempotence", () => {
  describe("Keybindings enable/disable idempotence", () => {
    let keybindings;
    let mockExt;

    beforeEach(() => {
      mockExt = {
        extWm: { command: vi.fn(), getPointer: vi.fn(() => [0, 0, 0]) },
        kbdSettings: { get_string: vi.fn(() => "Super"), get_strv: vi.fn(() => []) },
        settings: {
          get_uint: vi.fn(() => 10),
          get_string: vi.fn(() => ""),
          get_boolean: vi.fn(() => false),
        },
      };
      keybindings = new Keybindings(mockExt);
    });

    it("enable() twice registers each binding exactly once", () => {
      const addKeybinding = vi.fn();
      Main.wm.addKeybinding = addKeybinding;

      keybindings.enable();
      keybindings.enable();

      expect(addKeybinding).toHaveBeenCalledTimes(Object.keys(keybindings._bindings).length);
    });

    it("disable() then enable() re-registers (lock -> unlock cycle)", () => {
      const addKeybinding = vi.fn();
      const removeKeybinding = vi.fn();
      Main.wm.addKeybinding = addKeybinding;
      Main.wm.removeKeybinding = removeKeybinding;

      const bindingCount = Object.keys(keybindings._bindings).length;
      keybindings.enable();
      keybindings.disable();
      keybindings.enable();

      expect(addKeybinding).toHaveBeenCalledTimes(2 * bindingCount);
      expect(removeKeybinding).toHaveBeenCalledTimes(bindingCount);
    });

    it("disable() before any enable() does not call removeKeybinding", () => {
      const removeKeybinding = vi.fn();
      Main.wm.removeKeybinding = removeKeybinding;

      keybindings.disable();

      expect(removeKeybinding).not.toHaveBeenCalled();
    });

    it("disable() still hides a visible cheatsheet even when never enabled", () => {
      const hideFn = vi.fn();
      keybindings.cheatsheet = { visible: true, hide: hideFn };
      Main.wm.removeKeybinding = vi.fn();

      keybindings.disable();

      expect(hideFn).toHaveBeenCalled();
    });
  });

  describe("indicator idempotence on repeated user session updates", () => {
    let ext;

    beforeEach(() => {
      FeatureMenuToggle.mockClear();
      ext = new ForgeExtension();
      ext.keybindings = { enable: vi.fn(), disable: vi.fn() };
    });

    it("repeated 'user' session updates create exactly one menu toggle", () => {
      ext._onSessionModeChanged({ currentMode: "user" });
      ext._onSessionModeChanged({ currentMode: "user" });

      expect(ext.indicator.quickSettingsItems).toHaveLength(1);
      expect(FeatureMenuToggle).toHaveBeenCalledTimes(1);
    });

    it("unlock cycle recreates the indicator once", () => {
      ext._onSessionModeChanged({ currentMode: "user" });
      ext._onSessionModeChanged({ currentMode: "unlock-dialog" });
      ext._onSessionModeChanged({ currentMode: "user" });

      expect(ext.indicator.quickSettingsItems).toHaveLength(1);
      expect(FeatureMenuToggle).toHaveBeenCalledTimes(2);
    });

    it("repeated 'user' session updates enable keybindings idempotently via the guard", () => {
      ext._onSessionModeChanged({ currentMode: "user" });
      ext._onSessionModeChanged({ currentMode: "user" });

      // The extension delegates idempotence to Keybindings.enable(); the
      // handler itself may call it repeatedly.
      expect(ext.keybindings.enable).toHaveBeenCalled();
    });
  });
});
