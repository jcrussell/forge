import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Keybindings } from "../../../lib/extension/keybindings.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

/**
 * Keybindings behavioral tests
 *
 * Tests for allowDragDropTile() which determines whether a window drag should
 * trigger tiling based on the configured modifier key and current modifier state.
 * Uses Clutter modifier bitmask values: Super=64, Alt=8, Ctrl=4, Shift=1, grabbed=256.
 */
describe("Keybindings", () => {
  let keybindings;
  let mockExt;

  beforeEach(() => {
    mockExt = {
      extWm: {
        command: vi.fn(),
        getPointer: vi.fn(() => [0, 0, 0]),
      },
      kbdSettings: {
        get_string: vi.fn(() => "Super"),
        get_strv: vi.fn(() => []),
      },
      settings: {
        get_uint: vi.fn(() => 10),
        get_string: vi.fn(() => ""),
        get_boolean: vi.fn(() => false),
      },
    };

    keybindings = new Keybindings(mockExt);
  });

  describe("buildBindingDefinitions()", () => {
    it("should define all expected keybinding keys", () => {
      const expectedKeys = [
        "window-toggle-float",
        "window-toggle-always-float",
        "window-focus-left",
        "window-focus-down",
        "window-focus-up",
        "window-focus-right",
        "window-swap-left",
        "window-swap-down",
        "window-swap-up",
        "window-swap-right",
        "window-move-left",
        "window-move-down",
        "window-move-up",
        "window-move-right",
        "con-split-layout-toggle",
        "con-split-vertical",
        "con-split-horizontal",
        "con-stacked-layout-toggle",
        "con-tabbed-layout-toggle",
        "con-tabbed-showtab-decoration-toggle",
        "focus-border-toggle",
        "prefs-tiling-toggle",
        "window-gap-size-increase",
        "window-gap-size-decrease",
        "workspace-active-tile-toggle",
        "window-reset-sizes",
        "prefs-open",
        "window-swap-last-active",
        "window-focus-next",
        "window-focus-prev",
        "window-swap-next",
        "window-swap-prev",
        "window-snap-one-third-right",
        "window-snap-two-third-right",
        "window-snap-one-third-left",
        "window-snap-two-third-left",
        "window-snap-center",
        "window-resize-top-increase",
        "window-resize-top-decrease",
        "window-resize-bottom-increase",
        "window-resize-bottom-decrease",
        "window-resize-left-increase",
        "window-resize-left-decrease",
        "window-resize-right-increase",
        "window-resize-right-decrease",
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

      for (const key of expectedKeys) {
        expect(keybindings._bindings[key], `Missing binding: ${key}`).toBeDefined();
        expect(typeof keybindings._bindings[key]).toBe("function");
      }
    });

    it("should define bindings as callable functions", () => {
      for (const key of Object.keys(keybindings._bindings)) {
        expect(typeof keybindings._bindings[key]).toBe("function");
      }
    });
  });

  describe("command dispatch", () => {
    it("window-focus-left should dispatch Focus Left command", () => {
      keybindings._bindings["window-focus-left"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "Focus", direction: "Left" });
    });

    it("window-swap-right should dispatch Swap Right command", () => {
      keybindings._bindings["window-swap-right"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "Swap", direction: "Right" });
    });

    it("window-toggle-float should dispatch FloatToggle command", () => {
      keybindings._bindings["window-toggle-float"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith(
        expect.objectContaining({ name: "FloatToggle", mode: "float" })
      );
    });

    it("window-toggle-always-float should dispatch FloatClassToggle command", () => {
      keybindings._bindings["window-toggle-always-float"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith(
        expect.objectContaining({ name: "FloatClassToggle", mode: "float" })
      );
    });

    it("con-split-vertical should dispatch Split vertical command", () => {
      keybindings._bindings["con-split-vertical"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({
        name: "Split",
        orientation: "vertical",
      });
    });

    it("window-gap-size-increase should dispatch GapSize +1", () => {
      keybindings._bindings["window-gap-size-increase"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "GapSize", amount: 1 });
    });

    it("window-gap-size-decrease should dispatch GapSize -1", () => {
      keybindings._bindings["window-gap-size-decrease"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "GapSize", amount: -1 });
    });

    it("window-resize-top-increase should use resize-amount from settings", () => {
      mockExt.settings.get_uint.mockReturnValue(25);
      keybindings.buildBindingDefinitions();
      keybindings._bindings["window-resize-top-increase"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "WindowResizeTop", amount: 25 });
    });

    it("window-resize-top-decrease should negate resize-amount", () => {
      mockExt.settings.get_uint.mockReturnValue(25);
      keybindings.buildBindingDefinitions();
      keybindings._bindings["window-resize-top-decrease"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "WindowResizeTop", amount: -25 });
    });
  });

  describe("enable()", () => {
    it("should call addKeybinding for each binding", () => {
      const addKeybinding = vi.fn();

      Main.wm.addKeybinding = addKeybinding;

      keybindings.enable();

      const bindingCount = Object.keys(keybindings._bindings).length;
      expect(addKeybinding).toHaveBeenCalledTimes(bindingCount);
    });

    it("should pass kbdSettings to addKeybinding", () => {
      const addKeybinding = vi.fn();

      Main.wm.addKeybinding = addKeybinding;

      keybindings.enable();

      // Check the second argument of each call is kbdSettings
      for (const call of addKeybinding.mock.calls) {
        expect(call[1]).toBe(mockExt.kbdSettings);
      }
    });
  });

  describe("disable()", () => {
    it("should call removeKeybinding for each binding", () => {
      const removeKeybinding = vi.fn();

      Main.wm.addKeybinding = vi.fn();
      Main.wm.removeKeybinding = removeKeybinding;

      keybindings.enable();
      keybindings.disable();

      const bindingCount = Object.keys(keybindings._bindings).length;
      expect(removeKeybinding).toHaveBeenCalledTimes(bindingCount);
    });

    it("should remove all binding keys by name", () => {
      const removedKeys = [];

      Main.wm.addKeybinding = vi.fn();
      Main.wm.removeKeybinding = (key) => removedKeys.push(key);

      keybindings.enable();
      keybindings.disable();

      for (const key of Object.keys(keybindings._bindings)) {
        expect(removedKeys).toContain(key);
      }
    });

    it("should hide cheatsheet if visible", () => {
      const hideFn = vi.fn();
      keybindings.cheatsheet = { visible: true, hide: hideFn };

      Main.wm.removeKeybinding = vi.fn();

      keybindings.disable();

      expect(hideFn).toHaveBeenCalled();
    });

    it("should not hide cheatsheet if not visible", () => {
      const hideFn = vi.fn();
      keybindings.cheatsheet = { visible: false, hide: hideFn };

      Main.wm.removeKeybinding = vi.fn();

      keybindings.disable();

      expect(hideFn).not.toHaveBeenCalled();
    });

    it("should not throw if cheatsheet is null", () => {
      keybindings.cheatsheet = null;

      Main.wm.removeKeybinding = vi.fn();

      expect(() => keybindings.disable()).not.toThrow();
    });
  });

  describe("allowDragDropTile()", () => {
    describe("Super modifier", () => {
      beforeEach(() => {
        mockExt.kbdSettings.get_string.mockReturnValue("Super");
      });

      it("should allow tiling when Super is held (state=64)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should allow tiling when Super+grabbed (state=320)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 320]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should not allow tiling with no modifier (state=0)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Alt is held instead (state=8)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 8]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Ctrl is held instead (state=4)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 4]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });
    });

    describe("Alt modifier", () => {
      beforeEach(() => {
        mockExt.kbdSettings.get_string.mockReturnValue("Alt");
      });

      it("should allow tiling when Alt is held (state=8)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 8]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should allow tiling when Alt+grabbed (state=264)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 264]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should not allow tiling with no modifier (state=0)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Super is held instead (state=64)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Ctrl is held instead (state=4)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 4]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });
    });

    describe("Ctrl modifier", () => {
      beforeEach(() => {
        mockExt.kbdSettings.get_string.mockReturnValue("Ctrl");
      });

      it("should allow tiling when Ctrl is held (state=4)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 4]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should allow tiling when Ctrl+grabbed (state=260)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 260]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should not allow tiling with no modifier (state=0)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Super is held instead (state=64)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Alt is held instead (state=8)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 8]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });
    });

    describe("None modifier", () => {
      beforeEach(() => {
        mockExt.kbdSettings.get_string.mockReturnValue("None");
      });

      it("should always allow tiling regardless of state (state=0)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should always allow tiling regardless of state (state=64)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should always allow tiling regardless of state (state=256)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 256]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });
    });

    describe("Shift modifier", () => {
      beforeEach(() => {
        mockExt.kbdSettings.get_string.mockReturnValue("Shift");
      });

      it("should allow tiling when Shift is held (state=1)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 1]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should allow tiling when Shift is held while grabbed (state=257)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 257]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should not allow tiling with no modifier (state=0)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling on Caps Lock (LOCK_MASK state=2)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 2]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling with the wrong modifier (state=64 Super)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });
    });

    describe("unknown modifier value", () => {
      it("should not allow tiling for an unknown modifier string", () => {
        mockExt.kbdSettings.get_string.mockReturnValue("Hyper");
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling for empty modifier string", () => {
        mockExt.kbdSettings.get_string.mockReturnValue("");
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });
    });
  });

  describe("_directionalBindings()", () => {
    it("should generate 4 bindings for each direction", () => {
      const bindings = keybindings._directionalBindings("Focus", "window-focus");
      expect(Object.keys(bindings)).toEqual([
        "window-focus-left",
        "window-focus-down",
        "window-focus-up",
        "window-focus-right",
      ]);
    });

    it("should dispatch correct command with capitalized direction", () => {
      const bindings = keybindings._directionalBindings("Swap", "window-swap");
      bindings["window-swap-up"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "Swap", direction: "Up" });
    });

    it("should dispatch all four directions correctly", () => {
      const bindings = keybindings._directionalBindings("Move", "window-move");
      const expected = [
        ["window-move-left", "Left"],
        ["window-move-down", "Down"],
        ["window-move-up", "Up"],
        ["window-move-right", "Right"],
      ];
      for (const [key, dir] of expected) {
        mockExt.extWm.command.mockClear();
        bindings[key]();
        expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "Move", direction: dir });
      }
    });
  });

  describe("_simpleCommandBindings()", () => {
    it("should generate bindings from key-action map", () => {
      const bindings = keybindings._simpleCommandBindings({
        "my-key": { name: "TestCmd" },
        "other-key": { name: "OtherCmd", extra: 42 },
      });
      expect(Object.keys(bindings)).toEqual(["my-key", "other-key"]);
    });

    it("should dispatch the exact action object", () => {
      const bindings = keybindings._simpleCommandBindings({
        "my-key": { name: "TestCmd", extra: 42 },
      });
      bindings["my-key"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "TestCmd", extra: 42 });
    });
  });

  describe("_resizeBindings()", () => {
    it("should generate 8 bindings (4 directions x increase/decrease)", () => {
      const bindings = keybindings._resizeBindings();
      const keys = Object.keys(bindings);
      expect(keys).toHaveLength(8);
      expect(keys).toContain("window-resize-top-increase");
      expect(keys).toContain("window-resize-top-decrease");
      expect(keys).toContain("window-resize-bottom-increase");
      expect(keys).toContain("window-resize-bottom-decrease");
      expect(keys).toContain("window-resize-left-increase");
      expect(keys).toContain("window-resize-left-decrease");
      expect(keys).toContain("window-resize-right-increase");
      expect(keys).toContain("window-resize-right-decrease");
    });

    it("should read resize-amount at invocation time (increase)", () => {
      mockExt.settings.get_uint.mockReturnValue(15);
      const bindings = keybindings._resizeBindings();
      bindings["window-resize-left-increase"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({
        name: "WindowResizeLeft",
        amount: 15,
      });
    });

    it("should negate resize-amount for decrease", () => {
      mockExt.settings.get_uint.mockReturnValue(20);
      const bindings = keybindings._resizeBindings();
      bindings["window-resize-right-decrease"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({
        name: "WindowResizeRight",
        amount: -20,
      });
    });

    it("should use current settings value each invocation", () => {
      const bindings = keybindings._resizeBindings();
      mockExt.settings.get_uint.mockReturnValue(5);
      bindings["window-resize-top-increase"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "WindowResizeTop", amount: 5 });

      mockExt.extWm.command.mockClear();
      mockExt.settings.get_uint.mockReturnValue(30);
      bindings["window-resize-top-increase"]();
      expect(mockExt.extWm.command).toHaveBeenCalledWith({ name: "WindowResizeTop", amount: 30 });
    });
  });
});
