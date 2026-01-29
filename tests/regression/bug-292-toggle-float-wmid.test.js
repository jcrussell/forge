import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowManager, WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";
import { WindowType, Workspace } from "../mocks/gnome/Meta.js";

/**
 * Bug #292: toggle-float should use window-instance-id
 *
 * Problem: When using toggle-float, the matching logic uses window class and
 * title rather than window instance ID. This causes windows with the same
 * title (e.g., two terminals) to both float together when only one should
 * be floated.
 *
 * Root Cause: The float override matching checks wmClass and wmTitle but not
 * wmId (window instance ID). When two windows have identical class and title,
 * toggling float on one affects both.
 *
 * Fix: FloatToggle (Super+C) should use per-window wmId matching, while
 * FloatToggleAll (Super+Ctrl+C) should use class-based matching.
 *
 * Related: Bug #172 (toggling floating on one window toggles all of them)
 */
describe("Bug #292: toggle-float per-window vs per-class behavior", () => {
  let windowManager;
  let mockExtension;
  let mockSettings;
  let mockConfigMgr;

  beforeEach(() => {
    global.display = {
      get_workspace_manager: vi.fn(),
      get_n_monitors: vi.fn(() => 1),
      get_focus_window: vi.fn(() => null),
      get_current_monitor: vi.fn(() => 0),
      get_current_time: vi.fn(() => 12345),
      get_monitor_geometry: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    };

    const workspace0 = new Workspace({ index: 0 });

    global.workspace_manager = {
      get_n_workspaces: vi.fn(() => 1),
      get_workspace_by_index: vi.fn(() => workspace0),
      get_active_workspace_index: vi.fn(() => 0),
      get_active_workspace: vi.fn(() => workspace0),
    };

    global.display.get_workspace_manager.mockReturnValue(global.workspace_manager);

    global.window_group = {
      contains: vi.fn(() => false),
      add_child: vi.fn(),
      remove_child: vi.fn(),
    };

    global.get_current_time = vi.fn(() => 12345);

    mockSettings = {
      get_boolean: vi.fn((key) => {
        if (key === "focus-on-hover-enabled") return false;
        if (key === "tiling-mode-enabled") return true;
        return false;
      }),
      get_uint: vi.fn(() => 0),
      get_string: vi.fn(() => ""),
      set_boolean: vi.fn(),
      set_uint: vi.fn(),
      set_string: vi.fn(),
    };

    mockConfigMgr = {
      windowProps: {
        overrides: [],
      },
    };

    mockExtension = {
      metadata: { version: "1.0.0" },
      settings: mockSettings,
      configMgr: mockConfigMgr,
      keybindings: null,
      theme: {
        loadStylesheet: vi.fn(),
      },
    };

    windowManager = new WindowManager(mockExtension);
  });

  describe("Per-window float override with wmId", () => {
    it("should add float override with wmId for FloatToggle action", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add float override for terminal1 only (with wmId)
      windowManager.addFloatOverride(terminal1, true); // true = withWmId

      const overrides = mockConfigMgr.windowProps.overrides;

      // Should have one override with wmId
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmClass).toBe("gnome-terminal");
      expect(overrides[0].wmId).toBe("terminal-1");

      // terminal1 should be floating exempt
      expect(windowManager.isFloatingExempt(terminal1)).toBe(true);

      // terminal2 should NOT be floating exempt (different wmId)
      expect(windowManager.isFloatingExempt(terminal2)).toBe(false);
    });

    it("should not affect other windows with same class when using per-window toggle", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add per-window override
      windowManager.addFloatOverride(terminal1, true);

      // terminal2 should still tile
      expect(windowManager.isFloatingExempt(terminal2)).toBe(false);
    });

    it("should allow multiple per-window overrides for same class", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add per-window overrides for both
      windowManager.addFloatOverride(terminal1, true);
      windowManager.addFloatOverride(terminal2, true);

      const overrides = mockConfigMgr.windowProps.overrides;

      // Should have two separate overrides
      expect(overrides.length).toBe(2);
      expect(overrides[0].wmId).toBe("terminal-1");
      expect(overrides[1].wmId).toBe("terminal-2");
    });
  });

  describe("Class-wide float override without wmId", () => {
    it("should add float override without wmId for FloatToggleAll action", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add class-wide float override (without wmId)
      windowManager.addFloatOverride(terminal1, false); // false = class-based

      const overrides = mockConfigMgr.windowProps.overrides;

      // Should have one override without wmId
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmClass).toBe("gnome-terminal");
      expect(overrides[0].wmId).toBeUndefined();

      // Both terminals should be floating exempt
      expect(windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(windowManager.isFloatingExempt(terminal2)).toBe(true);
    });
  });

  describe("Removing float overrides", () => {
    it("should remove per-window override without affecting class-wide override", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add class-wide and per-window overrides
      mockConfigMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal", mode: "float" }, // class-wide
        { wmClass: "gnome-terminal", wmId: "terminal-1", mode: "float" }, // per-window
      ];

      windowManager = new WindowManager(mockExtension);

      // Remove per-window override for terminal1
      windowManager.removeFloatOverride(terminal1, true);

      // Class-wide override should still exist
      const overrides = mockConfigMgr.windowProps.overrides;
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmId).toBeUndefined();

      // terminal2 should still float (class-wide)
      expect(windowManager.isFloatingExempt(terminal2)).toBe(true);
    });

    it("should remove class-wide override and all associated per-window overrides", () => {
      mockConfigMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal", mode: "float" },
        { wmClass: "gnome-terminal", wmId: "terminal-1", mode: "float" },
        { wmClass: "gnome-terminal", wmId: "terminal-2", mode: "float" },
      ];

      windowManager = new WindowManager(mockExtension);

      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      // Remove class-wide (should remove all for the class)
      windowManager.removeFloatOverride(terminal1, false);

      // All overrides for gnome-terminal should be removed
      const overrides = mockConfigMgr.windowProps.overrides;
      const terminalOverrides = overrides.filter((o) => o.wmClass === "gnome-terminal");
      expect(terminalOverrides.length).toBe(0);
    });
  });

  describe("Duplicate override prevention", () => {
    it("should not add duplicate per-window override", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      // Try to add the same override twice
      windowManager.addFloatOverride(terminal1, true);
      windowManager.addFloatOverride(terminal1, true);

      const overrides = mockConfigMgr.windowProps.overrides;

      // Should only have one override
      expect(overrides.length).toBe(1);
    });

    it("should not add duplicate class-wide override", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      // Try to add class-wide override twice
      windowManager.addFloatOverride(terminal1, false);
      windowManager.addFloatOverride(terminal1, false);

      const overrides = mockConfigMgr.windowProps.overrides;

      // Should only have one override
      expect(overrides.length).toBe(1);
    });
  });
});
