import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowManager, WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";
import { WindowType, Workspace } from "../mocks/gnome/Meta.js";

/**
 * Bug #172: Toggle float on one window toggles all of same type
 *
 * Problem: When toggling floating on one gnome-terminal window, all gnome-terminal
 * instances become floating instead of just the one.
 *
 * Root Cause: In isFloatingExempt(), the condition treats wmId as optional,
 * so class-based overrides (without wmId) match ALL windows of that class.
 * Additionally, addFloatOverride() duplicate check may prevent per-window overrides.
 */
describe("Bug #172: Per-window float toggle", () => {
  let windowManager;
  let mockExtension;
  let mockSettings;
  let mockConfigMgr;

  beforeEach(() => {
    // Mock global
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
      get_workspace_by_index: vi.fn((i) => (i === 0 ? workspace0 : new Workspace({ index: i }))),
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

    // Mock settings
    mockSettings = {
      get_boolean: vi.fn((key) => {
        if (key === "focus-on-hover-enabled") return false;
        if (key === "tiling-mode-enabled") return true;
        if (key === "float-always-on-top-enabled") return false;
        return false;
      }),
      get_uint: vi.fn(() => 0),
      get_string: vi.fn(() => ""),
      set_boolean: vi.fn(),
      set_uint: vi.fn(),
      set_string: vi.fn(),
    };

    // Mock config manager
    mockConfigMgr = {
      windowProps: {
        overrides: [],
      },
    };

    // Mock extension
    mockExtension = {
      metadata: { version: "1.0.0" },
      settings: mockSettings,
      configMgr: mockConfigMgr,
      keybindings: null,
      theme: {
        loadStylesheet: vi.fn(),
      },
    };

    // Create WindowManager
    windowManager = new WindowManager(mockExtension);
  });

  describe("FloatToggle (per-window)", () => {
    it("should only float the specific window when using FloatToggle", () => {
      // Create two terminal windows with same wmClass but different wmIds
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Add both windows to tree
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        terminal1,
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        terminal2,
      );

      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow2.mode = WINDOW_MODES.TILE;

      // Float only terminal1 using per-window toggle
      const action = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      windowManager.toggleFloatingMode(action, terminal1);

      // After toggle, terminal1 should be floating
      expect(windowManager.isFloatingExempt(terminal1)).toBe(true);

      // Bug #172: terminal2 should NOT be affected
      expect(windowManager.isFloatingExempt(terminal2)).toBe(false);
    });

    it("should properly unfloat just one window", () => {
      // Create two terminal windows
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Add both windows to tree
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        terminal1,
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        terminal2,
      );

      // Float both windows initially using per-window toggle
      const floatAction = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      windowManager.toggleFloatingMode(floatAction, terminal1);
      windowManager.toggleFloatingMode(floatAction, terminal2);

      expect(windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(windowManager.isFloatingExempt(terminal2)).toBe(true);

      // Now unfloat only terminal1
      const unfloatAction = { name: "FloatToggle", mode: WINDOW_MODES.TILE };
      windowManager.toggleFloatingMode(unfloatAction, terminal1);

      // terminal1 should no longer be floating
      expect(windowManager.isFloatingExempt(terminal1)).toBe(false);

      // Bug #172: terminal2 should still be floating
      expect(windowManager.isFloatingExempt(terminal2)).toBe(true);
    });

    it("should not affect other windows of same wmClass when FloatToggle is used", () => {
      // Create three terminal windows
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      const terminal3 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1003,
        title: "Terminal 3",
        allows_resize: true,
      });

      // Add windows to tree
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      windowManager.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal1);
      windowManager.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal2);
      windowManager.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal3);

      // Float terminal2 only
      const action = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      windowManager.toggleFloatingMode(action, terminal2);

      // Only terminal2 should be floating
      expect(windowManager.isFloatingExempt(terminal1)).toBe(false);
      expect(windowManager.isFloatingExempt(terminal2)).toBe(true);
      expect(windowManager.isFloatingExempt(terminal3)).toBe(false);
    });
  });

  describe("FloatClassToggle (class-based)", () => {
    it("should float ALL windows of same class when FloatClassToggle is used", () => {
      // Create two terminal windows
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Add windows to tree
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      windowManager.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal1);
      windowManager.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal2);

      // Float using class-based toggle
      const action = { name: "FloatClassToggle", mode: WINDOW_MODES.FLOAT };
      windowManager.toggleFloatingMode(action, terminal1);

      // Both terminals should be floating (class-based behavior)
      expect(windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(windowManager.isFloatingExempt(terminal2)).toBe(true);
    });
  });

  describe("addFloatOverride per-window handling", () => {
    it("should add per-window override with wmId when withWmId is true", () => {
      const terminal = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal",
        allows_resize: true,
      });

      windowManager.addFloatOverride(terminal, true);

      const overrides = mockConfigMgr.windowProps.overrides;
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmId).toBe(1001);
      expect(overrides[0].wmClass).toBe("gnome-terminal-server");
    });

    it("should allow multiple per-window overrides for same wmClass", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      windowManager.addFloatOverride(terminal1, true);
      windowManager.addFloatOverride(terminal2, true);

      const overrides = mockConfigMgr.windowProps.overrides;
      expect(overrides.length).toBe(2);
      expect(overrides.some((o) => o.wmId === 1001)).toBe(true);
      expect(overrides.some((o) => o.wmId === 1002)).toBe(true);
    });

    it("should not add duplicate per-window override for same wmId", () => {
      const terminal = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal",
        allows_resize: true,
      });

      windowManager.addFloatOverride(terminal, true);
      windowManager.addFloatOverride(terminal, true);

      const overrides = mockConfigMgr.windowProps.overrides;
      expect(overrides.length).toBe(1);
    });
  });

  describe("removeFloatOverride per-window handling", () => {
    it("should only remove per-window override when withWmId is true", () => {
      // Setup: Add both class-based and per-window overrides
      mockConfigMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal-server", mode: "float" }, // class-based
        { wmClass: "gnome-terminal-server", wmId: 1001, mode: "float" }, // per-window
      ];

      const terminal = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal",
        allows_resize: true,
      });

      // Remove per-window override only
      windowManager.removeFloatOverride(terminal, true);

      const overrides = mockConfigMgr.windowProps.overrides;
      // Class-based override should remain
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmId).toBeUndefined();
    });

    it("should preserve other per-window overrides for same class", () => {
      // Setup: Add multiple per-window overrides
      mockConfigMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal-server", wmId: 1001, mode: "float" },
        { wmClass: "gnome-terminal-server", wmId: 1002, mode: "float" },
        { wmClass: "gnome-terminal-server", wmId: 1003, mode: "float" },
      ];

      const terminal = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal",
        allows_resize: true,
      });

      // Remove override for terminal with id 1002
      windowManager.removeFloatOverride(terminal, true);

      const overrides = mockConfigMgr.windowProps.overrides;
      expect(overrides.length).toBe(2);
      expect(overrides.some((o) => o.wmId === 1001)).toBe(true);
      expect(overrides.some((o) => o.wmId === 1002)).toBe(false);
      expect(overrides.some((o) => o.wmId === 1003)).toBe(true);
    });
  });

  describe("isFloatingExempt per-window matching", () => {
    it("should match per-window override only for specific wmId", () => {
      mockConfigMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal-server", wmId: 1001, mode: "float" },
      ];

      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Only terminal1 should match because wmId matches
      expect(windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(windowManager.isFloatingExempt(terminal2)).toBe(false);
    });

    it("should match class-based override for all windows of that class", () => {
      mockConfigMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal-server", mode: "float" }, // no wmId = class-based
      ];

      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Both should match because it's class-based
      expect(windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(windowManager.isFloatingExempt(terminal2)).toBe(true);
    });
  });
});
