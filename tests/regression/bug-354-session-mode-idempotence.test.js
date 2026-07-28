import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
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
      // forge-aggo: real GNOME emits parentMode:"user" on lock; a bare
      // {currentMode:"unlock-dialog"} is a shape the shell never sends and made
      // this assertion pass on both buggy and fixed code.
      ext._onSessionModeChanged({ currentMode: "unlock-dialog", parentMode: "user" });
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

  // forge-fu2 (gh-466): "keyboard locked at password entry after lock/suspend".
  // Forge keeps running on the lock screen (session-modes includes
  // unlock-dialog) to preserve the tree, so the ONLY thing standing between
  // its 40+ bindings and the password prompt is (a) the unlock-dialog branch
  // removing every binding and (b) registering with ActionMode.NORMAL, never
  // ALL/UNLOCK_SCREEN. Pin both through the real handler + real Keybindings.
  describe("forge-fu2 (gh-466): lock screen leaves no keybinding behind", () => {
    let ext;
    let keybindings;

    beforeEach(() => {
      const mockExt = {
        extWm: { command: vi.fn(), getPointer: vi.fn(() => [0, 0, 0]) },
        kbdSettings: { get_string: vi.fn(() => "Super"), get_strv: vi.fn(() => []) },
        settings: {
          get_uint: vi.fn(() => 10),
          get_string: vi.fn(() => ""),
          get_boolean: vi.fn(() => false),
        },
      };
      keybindings = new Keybindings(mockExt);
      ext = new ForgeExtension();
      ext.keybindings = keybindings;
    });

    it("an unlock-dialog session update removes every registered binding", () => {
      const addKeybinding = vi.fn();
      const removeKeybinding = vi.fn();
      Main.wm.addKeybinding = addKeybinding;
      Main.wm.removeKeybinding = removeKeybinding;

      ext._onSessionModeChanged({ currentMode: "user" });
      const registered = addKeybinding.mock.calls.map((c) => c[0]);
      expect(registered.length).toBeGreaterThan(0);

      // forge-aggo: feed the real lock-screen shape (parentMode:"user"); a bare
      // {currentMode:"unlock-dialog"} routed into the user branch on buggy code
      // yet this test still passed, guarding a real regression class vacuously.
      ext._onSessionModeChanged({ currentMode: "unlock-dialog", parentMode: "user" });

      const removed = removeKeybinding.mock.calls.map((c) => c[0]);
      expect(removed.sort()).toEqual(registered.slice().sort());
    });

    it("every binding registers as ActionMode.NORMAL + KeyBindingFlags.NONE", () => {
      const addKeybinding = vi.fn();
      Main.wm.addKeybinding = addKeybinding;

      ext._onSessionModeChanged({ currentMode: "user" });

      expect(addKeybinding.mock.calls.length).toBeGreaterThan(0);
      for (const [, , flags, actionMode] of addKeybinding.mock.calls) {
        expect(flags).toBe(Meta.KeyBindingFlags.NONE);
        expect(actionMode).toBe(Shell.ActionMode.NORMAL);
        // Never active on the lock/unlock screen.
        expect(actionMode & Shell.ActionMode.UNLOCK_SCREEN).toBe(0);
        expect(actionMode & Shell.ActionMode.LOCK_SCREEN).toBe(0);
      }
    });
  });
});
