import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowManager, WINDOW_MODES } from "../../lib/extension/window.js";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";
import { Rectangle, Workspace } from "../mocks/gnome/Meta.js";

/**
 * Bug: Three-window resize causes overflow
 *
 * Problem: When resizing windows with 3+ siblings (via mouse drag or keyboard
 * shortcuts Ctrl-Super-O/Y):
 * 1. Windows "fall behind" others (get obscured)
 * 2. Windows become "insanely wide"
 * 3. Snap-back behavior on mouse release
 *
 * Root Cause: Windows start with `percent = 0.0`. During resize, only 2 windows
 * get percentages set (focused + resize pair). The third window stays at
 * `percent = 0.0`. `_normalizeSiblingPercents()` skipped windows with
 * `percent <= 0`, but `computeSizes()` used default `1/N` for them, causing
 * total > 1.0 and overflow.
 *
 * Fix: `_normalizeSiblingPercents()` now initializes missing percentages based
 * on current rect proportions before normalizing.
 */
describe("Bug: Three-window resize overflow", () => {
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

    // Mock settings
    mockSettings = {
      get_boolean: vi.fn((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-on-hover-enabled") return false;
        return false;
      }),
      get_uint: vi.fn(() => 0),
      get_string: vi.fn(() => ""),
      get_double: vi.fn(() => 0.0),
      set_boolean: vi.fn(),
      set_uint: vi.fn(),
      set_string: vi.fn(),
      connect: vi.fn().mockReturnValue(1),
      disconnect: vi.fn(),
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

  describe("_normalizeSiblingPercents initialization", () => {
    it("should initialize zero-percent children based on current rect", () => {
      // Create parent with 3 children where one has percent = 0
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
        allows_resize: true,
        rect: new Rectangle({ x: 0, y: 0, width: 300, height: 600 }),
      });

      const window2 = createMockWindow({
        wm_class: "TestApp",
        id: 1002,
        title: "Window 2",
        allows_resize: true,
        rect: new Rectangle({ x: 300, y: 0, width: 300, height: 600 }),
      });

      const window3 = createMockWindow({
        wm_class: "TestApp",
        id: 1003,
        title: "Window 3",
        allows_resize: true,
        rect: new Rectangle({ x: 600, y: 0, width: 300, height: 600 }),
      });

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window2
      );
      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window3
      );

      // Simulate bug scenario: after resize, only 2 windows have percentages
      nodeWindow1.percent = 0; // Uninitialized (the bug!)
      nodeWindow2.percent = 0.4; // Set from resize
      nodeWindow3.percent = 0.267; // Set from resize pair

      // Set rects for the calculation
      nodeWindow1.rect = { x: 0, y: 0, width: 300, height: 600 };
      nodeWindow2.rect = { x: 300, y: 0, width: 300, height: 600 };
      nodeWindow3.rect = { x: 600, y: 0, width: 300, height: 600 };

      windowManager._normalizeSiblingPercents(monitor);

      // All children should now have valid percentages
      expect(nodeWindow1.percent).toBeGreaterThan(0);
      expect(nodeWindow2.percent).toBeGreaterThan(0);
      expect(nodeWindow3.percent).toBeGreaterThan(0);

      // Total should be approximately 1.0
      const total = nodeWindow1.percent + nodeWindow2.percent + nodeWindow3.percent;
      expect(total).toBeCloseTo(1.0, 3);
    });

    it("should preserve relative proportions when initializing missing percentages", () => {
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
        rect: new Rectangle({ x: 0, y: 0, width: 300, height: 600 }),
      });

      const window2 = createMockWindow({
        wm_class: "TestApp",
        id: 1002,
        title: "Window 2",
        rect: new Rectangle({ x: 300, y: 0, width: 450, height: 600 }),
      });

      const window3 = createMockWindow({
        wm_class: "TestApp",
        id: 1003,
        title: "Window 3",
        rect: new Rectangle({ x: 750, y: 0, width: 150, height: 600 }),
      });

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window2
      );
      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window3
      );

      // window1 uninitialized, others have percentages from resize
      nodeWindow1.percent = 0;
      nodeWindow2.percent = 0.5;
      nodeWindow3.percent = 0.167;

      nodeWindow1.rect = { x: 0, y: 0, width: 300, height: 600 };
      nodeWindow2.rect = { x: 300, y: 0, width: 450, height: 600 };
      nodeWindow3.rect = { x: 750, y: 0, width: 150, height: 600 };

      windowManager._normalizeSiblingPercents(monitor);

      // window1 should be initialized based on its rect (300/900 = 0.333)
      expect(nodeWindow1.percent).toBeGreaterThan(0);

      // Ratios should be preserved (window2 should still be larger than window3)
      expect(nodeWindow2.percent).toBeGreaterThan(nodeWindow3.percent);

      // Total should be 1.0
      const total = nodeWindow1.percent + nodeWindow2.percent + nodeWindow3.percent;
      expect(total).toBeCloseTo(1.0, 3);
    });

    it("should handle vertical layout (VSPLIT)", () => {
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.VSPLIT;
      monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
        rect: new Rectangle({ x: 0, y: 0, width: 900, height: 200 }),
      });

      const window2 = createMockWindow({
        wm_class: "TestApp",
        id: 1002,
        title: "Window 2",
        rect: new Rectangle({ x: 0, y: 200, width: 900, height: 400 }),
      });

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window2
      );

      // Simulate resize: window1 uninitialized
      nodeWindow1.percent = 0;
      nodeWindow2.percent = 0.5;

      nodeWindow1.rect = { x: 0, y: 0, width: 900, height: 200 };
      nodeWindow2.rect = { x: 0, y: 200, width: 900, height: 400 };

      windowManager._normalizeSiblingPercents(monitor);

      expect(nodeWindow1.percent).toBeGreaterThan(0);
      expect(nodeWindow2.percent).toBeGreaterThan(0);

      const total = nodeWindow1.percent + nodeWindow2.percent;
      expect(total).toBeCloseTo(1.0, 3);
    });

    it("should use equal distribution when rect is not available", () => {
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
      });

      const window2 = createMockWindow({
        wm_class: "TestApp",
        id: 1002,
        title: "Window 2",
      });

      const window3 = createMockWindow({
        wm_class: "TestApp",
        id: 1003,
        title: "Window 3",
      });

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window2
      );
      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window3
      );

      // All windows uninitialized, no rects
      nodeWindow1.percent = 0;
      nodeWindow2.percent = 0;
      nodeWindow3.percent = 0;

      nodeWindow1.rect = null;
      nodeWindow2.rect = null;
      nodeWindow3.rect = null;

      windowManager._normalizeSiblingPercents(monitor);

      // All should get equal distribution (1/3 each)
      expect(nodeWindow1.percent).toBeCloseTo(1 / 3, 3);
      expect(nodeWindow2.percent).toBeCloseTo(1 / 3, 3);
      expect(nodeWindow3.percent).toBeCloseTo(1 / 3, 3);

      const total = nodeWindow1.percent + nodeWindow2.percent + nodeWindow3.percent;
      expect(total).toBeCloseTo(1.0, 3);
    });
  });

  describe("computeSizes with three windows", () => {
    it("should not exceed parent size when percentages are properly initialized", () => {
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

      const children = [];
      for (let i = 0; i < 3; i++) {
        const window = createMockWindow({
          wm_class: "TestApp",
          id: 1001 + i,
          title: `Window ${i}`,
          rect: new Rectangle({ x: i * 300, y: 0, width: 300, height: 600 }),
        });
        const nodeWindow = windowManager.tree.createNode(
          monitor.nodeValue,
          NODE_TYPES.WINDOW,
          window
        );
        nodeWindow.percent = 1.0 / 3;
        nodeWindow.rect = { x: i * 300, y: 0, width: 300, height: 600 };
        children.push(nodeWindow);
      }

      const sizes = windowManager.tree.computeSizes(monitor, children);
      const total = sizes.reduce((a, b) => a + b, 0);

      expect(total).toBe(900);
    });

    it("should handle resize scenario where one window has percent=0 after normalization", () => {
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

      const window1 = createMockWindow({
        wm_class: "TestApp",
        id: 1001,
        title: "Window 1",
        rect: new Rectangle({ x: 0, y: 0, width: 300, height: 600 }),
      });
      const window2 = createMockWindow({
        wm_class: "TestApp",
        id: 1002,
        title: "Window 2",
        rect: new Rectangle({ x: 300, y: 0, width: 300, height: 600 }),
      });
      const window3 = createMockWindow({
        wm_class: "TestApp",
        id: 1003,
        title: "Window 3",
        rect: new Rectangle({ x: 600, y: 0, width: 300, height: 600 }),
      });

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window1
      );
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window2
      );
      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        window3
      );

      // Bug scenario: percent=0 on one window
      nodeWindow1.percent = 0;
      nodeWindow2.percent = 0.5;
      nodeWindow3.percent = 0.5;

      nodeWindow1.rect = { x: 0, y: 0, width: 300, height: 600 };
      nodeWindow2.rect = { x: 300, y: 0, width: 300, height: 600 };
      nodeWindow3.rect = { x: 600, y: 0, width: 300, height: 600 };

      // First normalize (this is the fix)
      windowManager._normalizeSiblingPercents(monitor);

      // Now compute sizes
      const children = [nodeWindow1, nodeWindow2, nodeWindow3];
      const sizes = windowManager.tree.computeSizes(monitor, children);
      const total = sizes.reduce((a, b) => a + b, 0);

      // Total should equal parent width (not exceed it)
      expect(total).toBe(900);
    });
  });

  describe("Full resize workflow simulation", () => {
    it("should handle keyboard resize (grow right) without overflow", () => {
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

      // Create 3 windows side-by-side
      const windows = [];
      const nodes = [];
      for (let i = 0; i < 3; i++) {
        const window = createMockWindow({
          wm_class: "TestApp",
          id: 1001 + i,
          title: `Window ${i}`,
          rect: new Rectangle({ x: i * 300, y: 0, width: 300, height: 600 }),
        });
        const node = windowManager.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);
        node.percent = 1 / 3;
        node.rect = { x: i * 300, y: 0, width: 300, height: 600 };
        windows.push(window);
        nodes.push(node);
      }

      // Simulate keyboard resize: focus middle window, grow right
      // This would typically set middle.percent += delta, right.percent -= delta
      // but leave left.percent at 0 if it was never set
      nodes[0].percent = 0; // Bug: never initialized
      nodes[1].percent = 0.4; // Grew
      nodes[2].percent = 0.267; // Shrunk (from 0.333)

      // Fix: normalize before computing sizes
      windowManager._normalizeSiblingPercents(monitor);

      // All windows should have valid percentages
      expect(nodes[0].percent).toBeGreaterThan(0);
      expect(nodes[1].percent).toBeGreaterThan(0);
      expect(nodes[2].percent).toBeGreaterThan(0);

      const total = nodes[0].percent + nodes[1].percent + nodes[2].percent;
      expect(total).toBeCloseTo(1.0, 3);

      // Verify sizes don't overflow
      const sizes = windowManager.tree.computeSizes(monitor, nodes);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(900);
    });
  });
});
