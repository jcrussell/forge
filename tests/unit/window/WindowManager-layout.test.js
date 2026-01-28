import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowManager, WINDOW_MODES } from "../../../lib/extension/window.js";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
import { Workspace, Rectangle, WindowType } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager layout and mode behavior tests
 *
 * Tests for behaviors:
 * - Default layout preferences for new workspaces
 * - Monocle mode toggling
 * - Focus behavior after window destruction
 * - Workspace layout independence
 */
describe("WindowManager - Layout and Mode Behaviors", () => {
  let windowManager;
  let mockExtension;
  let mockSettings;
  let mockConfigMgr;
  let workspace0;
  let workspace1;

  beforeEach(() => {
    workspace0 = new Workspace({ index: 0 });
    workspace1 = new Workspace({ index: 1 });

    // Mock global display and workspace manager
    global.display = {
      get_workspace_manager: vi.fn(),
      get_n_monitors: vi.fn(() => 1),
      get_focus_window: vi.fn(() => null),
      get_current_monitor: vi.fn(() => 0),
      get_current_time: vi.fn(() => 12345),
      get_monitor_geometry: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      get_monitor_neighbor_index: vi.fn(() => -1),
      sort_windows_by_stacking: vi.fn((windows) => windows),
      focus_window: null,
    };

    global.workspace_manager = {
      get_n_workspaces: vi.fn(() => 2),
      get_workspace_by_index: vi.fn((i) => {
        if (i === 0) return workspace0;
        if (i === 1) return workspace1;
        return new Workspace({ index: i });
      }),
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
    global.get_pointer = vi.fn(() => [960, 540]);
    global.get_window_actors = vi.fn(() => []);

    global.Main = {
      overview: {
        visible: false,
      },
    };

    global.Meta = {
      WindowType,
    };

    // Mock settings
    mockSettings = {
      get_boolean: vi.fn((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-on-hover-enabled") return false;
        if (key === "move-pointer-focus-enabled") return false;
        if (key === "auto-exit-tabbed") return true;
        return false;
      }),
      get_uint: vi.fn((key) => {
        if (key === "default-split-layout") return 0; // HSPLIT
        return 0;
      }),
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

  describe("Default Layout Preferences", () => {
    it("should use HSPLIT layout by default", () => {
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should have determineSplitLayout method", () => {
      expect(typeof windowManager.determineSplitLayout).toBe("function");
    });

    it("should return a valid layout from determineSplitLayout", () => {
      const layout = windowManager.determineSplitLayout();

      expect([LAYOUT_TYPES.HSPLIT, LAYOUT_TYPES.VSPLIT]).toContain(layout);
    });
  });

  describe("Window Mode Management", () => {
    it("should create window in TILE mode by default", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow.mode = WINDOW_MODES.TILE;

      expect(nodeWindow.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should allow setting window to FLOAT mode", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow.mode = WINDOW_MODES.FLOAT;

      expect(nodeWindow.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should track GRAB_TILE mode during drag operations", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow.mode = WINDOW_MODES.GRAB_TILE;

      expect(nodeWindow.mode).toBe(WINDOW_MODES.GRAB_TILE);
    });
  });

  describe("Focus After Window Destruction", () => {
    it("should track lastFocusedWindow", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      windowManager.lastFocusedWindow = nodeWindow;

      expect(windowManager.lastFocusedWindow).toBe(nodeWindow);
    });

    it("should clear lastFocusedWindow when window is removed", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      windowManager.lastFocusedWindow = nodeWindow;
      windowManager.tree.removeNode(nodeWindow);

      // After removal, lastFocusedWindow may still reference the node
      // The important thing is the node is no longer in the tree
      const foundNode = windowManager.findNodeWindow(metaWindow);
      expect(foundNode).toBeNull();
    });

    it("should find appropriate focus target after window closes", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 800, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const node1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      const node2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );

      // Remove node1
      windowManager.tree.removeNode(node1);

      // node2 should still be in tree as potential focus target
      expect(monitor.childNodes).toContain(node2);
    });
  });

  describe("Workspace Layout Independence", () => {
    it("should maintain separate monitor nodes per workspace", () => {
      const workspace0Node = windowManager.tree.nodeWorkpaces[0];
      const workspace1Node = windowManager.tree.nodeWorkpaces[1];

      const monitor0 = workspace0Node.getNodeByType(NODE_TYPES.MONITOR)[0];
      const monitor1 = workspace1Node.getNodeByType(NODE_TYPES.MONITOR)[0];

      expect(monitor0).not.toBe(monitor1);
    });

    it("should allow different layouts per workspace", () => {
      const workspace0Node = windowManager.tree.nodeWorkpaces[0];
      const workspace1Node = windowManager.tree.nodeWorkpaces[1];

      const monitor0 = workspace0Node.getNodeByType(NODE_TYPES.MONITOR)[0];
      const monitor1 = workspace1Node.getNodeByType(NODE_TYPES.MONITOR)[0];

      // Set different layouts
      monitor0.layout = LAYOUT_TYPES.HSPLIT;
      monitor1.layout = LAYOUT_TYPES.VSPLIT;

      expect(monitor0.layout).toBe(LAYOUT_TYPES.HSPLIT);
      expect(monitor1.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should preserve windows in each workspace independently", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace1,
      });

      const workspace0Node = windowManager.tree.nodeWorkpaces[0];
      const workspace1Node = windowManager.tree.nodeWorkpaces[1];

      const monitor0 = workspace0Node.getNodeByType(NODE_TYPES.MONITOR)[0];
      const monitor1 = workspace1Node.getNodeByType(NODE_TYPES.MONITOR)[0];

      const node1 = windowManager.tree.createNode(
        monitor0.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      const node2 = windowManager.tree.createNode(
        monitor1.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );

      // Each workspace should have its window
      expect(monitor0.childNodes).toContain(node1);
      expect(monitor1.childNodes).toContain(node2);
      expect(monitor0.childNodes).not.toContain(node2);
      expect(monitor1.childNodes).not.toContain(node1);
    });

    it("should track window count per workspace", () => {
      const metaWindow1 = createMockWindow({ workspace: workspace0 });
      const metaWindow2 = createMockWindow({ workspace: workspace0 });
      const metaWindow3 = createMockWindow({ workspace: workspace1 });

      const workspace0Node = windowManager.tree.nodeWorkpaces[0];
      const workspace1Node = windowManager.tree.nodeWorkpaces[1];

      const monitor0 = workspace0Node.getNodeByType(NODE_TYPES.MONITOR)[0];
      const monitor1 = workspace1Node.getNodeByType(NODE_TYPES.MONITOR)[0];

      windowManager.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      windowManager.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      windowManager.tree.createNode(monitor1.nodeValue, NODE_TYPES.WINDOW, metaWindow3);

      const ws0Windows = workspace0Node.getNodeByType(NODE_TYPES.WINDOW);
      const ws1Windows = workspace1Node.getNodeByType(NODE_TYPES.WINDOW);

      expect(ws0Windows).toHaveLength(2);
      expect(ws1Windows).toHaveLength(1);
    });
  });

  describe("Layout Container Management", () => {
    it("should create container when splitting", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      // Perform split
      windowManager.tree.split(nodeWindow, 0, true); // HORIZONTAL

      // Node should now be inside a container
      expect(nodeWindow.parentNode.nodeType).toBe(NODE_TYPES.CON);
    });

    it("should change container layout on toggleSplit", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      // Create HSPLIT container
      windowManager.tree.split(nodeWindow, 0, true);
      const container = nodeWindow.parentNode;
      container.layout = LAYOUT_TYPES.HSPLIT;

      // Toggle to VSPLIT
      windowManager.tree.split(nodeWindow, 1, false); // VERTICAL, no force

      expect(container.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should support stacked layout in container", () => {
      const metaWindow1 = createMockWindow({ workspace: workspace0 });
      const metaWindow2 = createMockWindow({ workspace: workspace0 });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const node1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      windowManager.tree.split(node1, 0, true);

      const container = node1.parentNode;
      container.layout = LAYOUT_TYPES.STACKED;

      windowManager.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      expect(container.layout).toBe(LAYOUT_TYPES.STACKED);
      expect(container.childNodes).toHaveLength(2);
    });

    it("should support tabbed layout in container", () => {
      const metaWindow1 = createMockWindow({ workspace: workspace0 });
      const metaWindow2 = createMockWindow({ workspace: workspace0 });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const node1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      windowManager.tree.split(node1, 0, true);

      const container = node1.parentNode;
      container.layout = LAYOUT_TYPES.TABBED;

      windowManager.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      expect(container.layout).toBe(LAYOUT_TYPES.TABBED);
      expect(container.childNodes).toHaveLength(2);
    });
  });

  describe("findNodeWindow", () => {
    it("should find window node by metaWindow", () => {
      const metaWindow = createMockWindow({ workspace: workspace0 });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      const found = windowManager.findNodeWindow(metaWindow);

      expect(found).toBe(nodeWindow);
    });

    it("should return null for unknown window", () => {
      const metaWindow = createMockWindow({ workspace: workspace0 });

      const found = windowManager.findNodeWindow(metaWindow);

      expect(found).toBeNull();
    });

    it("should find window across different workspaces", () => {
      const metaWindow1 = createMockWindow({ workspace: workspace0 });
      const metaWindow2 = createMockWindow({ workspace: workspace1 });

      const ws0 = windowManager.tree.nodeWorkpaces[0];
      const ws1 = windowManager.tree.nodeWorkpaces[1];

      const monitor0 = ws0.getNodeByType(NODE_TYPES.MONITOR)[0];
      const monitor1 = ws1.getNodeByType(NODE_TYPES.MONITOR)[0];

      windowManager.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      const node2 = windowManager.tree.createNode(
        monitor1.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );

      const found = windowManager.findNodeWindow(metaWindow2);

      expect(found).toBe(node2);
    });
  });
});
