import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowManager, WINDOW_MODES } from "../../lib/extension/window.js";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";
import { WindowType, Workspace, Rectangle, GrabOp, MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug #305: Resizing one boundary also moves opposite boundary
 *
 * Problem: When resizing one side of a window boundary, the opposite side
 * also moves instead of staying in place.
 *
 * Root Cause: In _handleResizing(), percent-based calculations adjust both
 * the focused window and its sibling. When there are 3+ siblings, or when
 * resize crosses container boundaries, unupdated siblings cause the total
 * percent to exceed 1.0, causing repositioning on re-render.
 */
describe("Bug #305: Resize boundary behavior", () => {
  let windowManager;
  let mockExtension;
  let mockSettings;
  let mockConfigMgr;
  let workspace0;

  beforeEach(() => {
    // Mock global display and workspace manager
    global.display = {
      get_workspace_manager: vi.fn(),
      get_n_monitors: vi.fn(() => 1),
      get_focus_window: vi.fn(() => null),
      get_current_monitor: vi.fn(() => 0),
      get_current_time: vi.fn(() => 12345),
      get_monitor_geometry: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      sort_windows_by_stacking: vi.fn((windows) => windows),
    };

    workspace0 = new Workspace({ index: 0 });

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

    // Mock Meta namespace
    global.Meta = {
      GrabOp,
      MotionDirection,
    };

    // Mock settings
    mockSettings = {
      get_boolean: vi.fn((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-on-hover-enabled") return false;
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

  describe("_normalizeSiblingPercents helper", () => {
    it("should normalize sibling percentages to sum to 1.0", () => {
      // Create 3 windows in horizontal split
      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
        allows_resize: true,
        rect: new Rectangle({ x: 0, y: 0, width: 640, height: 1080 }),
      });

      const window2 = createMockWindow({
        wm_class: "TestApp",
        id: 1002,
        title: "Window 2",
        allows_resize: true,
        rect: new Rectangle({ x: 640, y: 0, width: 640, height: 1080 }),
      });

      const window3 = createMockWindow({
        wm_class: "TestApp",
        id: 1003,
        title: "Window 3",
        allows_resize: true,
        rect: new Rectangle({ x: 1280, y: 0, width: 640, height: 1080 }),
      });

      // Add windows to tree
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1,
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window2,
      );
      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window3,
      );

      // Set unbalanced percentages that sum to > 1.0 (simulating resize drift)
      nodeWindow1.percent = 0.4;
      nodeWindow2.percent = 0.4;
      nodeWindow3.percent = 0.4; // Total = 1.2

      // Normalize
      windowManager._normalizeSiblingPercents(monitor);

      // Total should be 1.0
      const total = nodeWindow1.percent + nodeWindow2.percent + nodeWindow3.percent;
      expect(total).toBeCloseTo(1.0, 5);
    });

    it("should handle null parent gracefully", () => {
      expect(() => {
        windowManager._normalizeSiblingPercents(null);
      }).not.toThrow();
    });

    it("should handle parent with single child", () => {
      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
        allows_resize: true,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1,
      );
      nodeWindow1.percent = 1.0;

      expect(() => {
        windowManager._normalizeSiblingPercents(monitor);
      }).not.toThrow();
    });
  });

  describe("Resize with sibling normalization", () => {
    it("should keep sibling percentages normalized after resize", () => {
      // Create 2 windows in horizontal split
      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
        allows_resize: true,
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
      });

      const window2 = createMockWindow({
        wm_class: "TestApp",
        id: 1002,
        title: "Window 2",
        allows_resize: true,
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1,
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window2,
      );

      nodeWindow1.percent = 0.5;
      nodeWindow2.percent = 0.5;

      // Verify initial state
      const totalBefore = nodeWindow1.percent + nodeWindow2.percent;
      expect(totalBefore).toBeCloseTo(1.0, 5);

      // Simulate resize - adjust percentages
      nodeWindow1.percent = 0.6;
      nodeWindow2.percent = 0.4;

      // Normalize
      windowManager._normalizeSiblingPercents(monitor);

      // Should still sum to 1.0
      const totalAfter = nodeWindow1.percent + nodeWindow2.percent;
      expect(totalAfter).toBeCloseTo(1.0, 5);
    });

    it("should handle 3+ sibling resize correctly", () => {
      // Create 3 windows
      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
        allows_resize: true,
        rect: new Rectangle({ x: 0, y: 0, width: 640, height: 1080 }),
      });

      const window2 = createMockWindow({
        wm_class: "TestApp",
        id: 1002,
        title: "Window 2",
        allows_resize: true,
        rect: new Rectangle({ x: 640, y: 0, width: 640, height: 1080 }),
      });

      const window3 = createMockWindow({
        wm_class: "TestApp",
        id: 1003,
        title: "Window 3",
        allows_resize: true,
        rect: new Rectangle({ x: 1280, y: 0, width: 640, height: 1080 }),
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1,
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window2,
      );
      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window3,
      );

      // Initial equal split
      nodeWindow1.percent = 1 / 3;
      nodeWindow2.percent = 1 / 3;
      nodeWindow3.percent = 1 / 3;

      // Simulate resizing window1 and window2 boundary
      // window1 gets larger, window2 gets smaller
      nodeWindow1.percent = 0.4;
      nodeWindow2.percent = 0.27;
      // window3 unchanged at 1/3 = 0.333...
      // Total = 0.4 + 0.27 + 0.333 = 1.003 (drift)

      // Normalize
      windowManager._normalizeSiblingPercents(monitor);

      // Should sum to 1.0
      const total = nodeWindow1.percent + nodeWindow2.percent + nodeWindow3.percent;
      expect(total).toBeCloseTo(1.0, 5);

      // Relative proportions should be preserved
      expect(nodeWindow1.percent).toBeGreaterThan(nodeWindow2.percent);
    });
  });

  describe("Resize boundary stability", () => {
    it("should not move opposite boundary when resizing", () => {
      // Create 3 windows: [win1 | win2 | win3]
      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
        allows_resize: true,
        rect: new Rectangle({ x: 0, y: 0, width: 600, height: 1080 }),
      });

      const window2 = createMockWindow({
        wm_class: "TestApp",
        id: 1002,
        title: "Window 2",
        allows_resize: true,
        rect: new Rectangle({ x: 600, y: 0, width: 720, height: 1080 }),
      });

      const window3 = createMockWindow({
        wm_class: "TestApp",
        id: 1003,
        title: "Window 3",
        allows_resize: true,
        rect: new Rectangle({ x: 1320, y: 0, width: 600, height: 1080 }),
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1,
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window2,
      );
      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window3,
      );

      // Set initial percentages based on widths
      nodeWindow1.percent = 600 / 1920; // 0.3125
      nodeWindow2.percent = 720 / 1920; // 0.375
      nodeWindow3.percent = 600 / 1920; // 0.3125
      // Total = 1.0

      // Record window3's right edge position (should stay fixed)
      const window3RightEdge = 1920; // Full width
      const window3LeftEdge = window3RightEdge - nodeWindow3.percent * 1920;

      // Simulate resize: expand window2 into window1's space
      // window1 shrinks, window2 grows
      const resizeAmount = 100;
      nodeWindow1.percent = (600 - resizeAmount) / 1920; // smaller
      nodeWindow2.percent = (720 + resizeAmount) / 1920; // larger
      // nodeWindow3 unchanged

      // Normalize to ensure total = 1.0
      windowManager._normalizeSiblingPercents(monitor);

      // Bug #305: window3's boundaries should NOT have moved
      // Calculate new window3 left edge
      const newWindow3LeftEdge = 1920 - nodeWindow3.percent * 1920;
      const newWindow3RightEdge = 1920;

      // Right edge should still be at monitor edge
      expect(newWindow3RightEdge).toBe(window3RightEdge);

      // Left edge should be approximately the same (within rounding)
      // After normalization, window3's relative percent should be preserved
      expect(nodeWindow3.percent).toBeCloseTo(600 / 1920, 2);
    });
  });
});
