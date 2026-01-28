import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowManager, WINDOW_MODES } from "../../../lib/extension/window.js";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
import { Workspace, Rectangle } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager drag-and-drop tiling tests
 *
 * Tests for drag-drop behaviors including:
 * - moveWindowToPointer(): Tile windows by dragging to edges
 * - Region detection (left, right, top, bottom, center)
 * - Center layout modes (SWAP, STACKED, TABBED)
 * - Stacked/tabbed container handling
 * - Edge cases (self-drop, minimized, floating targets)
 */
describe("WindowManager - Drag and Drop Tiling", () => {
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
    global.get_pointer = vi.fn(() => [960, 540]); // Center of screen

    // Mock settings
    mockSettings = {
      get_boolean: vi.fn((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-on-hover-enabled") return false;
        if (key === "preview-hint-enabled") return false;
        return false;
      }),
      get_uint: vi.fn(() => 0),
      get_string: vi.fn((key) => {
        if (key === "dnd-center-layout") return "SWAP";
        return "";
      }),
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

  describe("moveWindowToPointer - Basic Guard Conditions", () => {
    it("should return early when cancelGrab is true", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
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

      windowManager.cancelGrab = true;
      const treeSpy = vi.spyOn(windowManager.tree, "resetSiblingPercent");

      windowManager.moveWindowToPointer(nodeWindow, false);

      expect(treeSpy).not.toHaveBeenCalled();
    });

    it("should return early when focusNodeWindow is null", () => {
      const treeSpy = vi.spyOn(windowManager.tree, "resetSiblingPercent");

      windowManager.moveWindowToPointer(null, false);

      expect(treeSpy).not.toHaveBeenCalled();
    });

    it("should return early when focusNodeWindow mode is not GRAB_TILE", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
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

      const treeSpy = vi.spyOn(windowManager.tree, "resetSiblingPercent");

      windowManager.moveWindowToPointer(nodeWindow, false);

      expect(treeSpy).not.toHaveBeenCalled();
    });

    it("should return early when nodeWinAtPointer has invalid structure", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.GRAB_TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );

      // Set up pointer to be over window 2
      global.get_pointer = vi.fn(() => [1200, 540]);
      windowManager.nodeWinAtPointer = { nodeValue: null, parentNode: null };

      const treeSpy = vi.spyOn(windowManager.tree, "resetSiblingPercent");

      windowManager.moveWindowToPointer(nodeWindow1, false);

      expect(treeSpy).not.toHaveBeenCalled();
    });
  });

  describe("moveWindowToPointer - LEFT Edge Drop", () => {
    it("should tile window to the left when dragged to left edge", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      // Target window (drop target)
      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      // Dragged window
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      // Point to left edge region (0-30% of width)
      global.get_pointer = vi.fn(() => [100, 540]); // Left region

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      // After drop, the parent should be HSPLIT
      expect(nodeWindow2.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should create horizontal split container when dropping left in vertical layout", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 540 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 540, width: 1920, height: 540 }),
        workspace: workspace0,
      });
      const metaWindow3 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 540 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow3
      );
      nodeWindow3.mode = WINDOW_MODES.GRAB_TILE;

      // Point to left edge of window1
      global.get_pointer = vi.fn(() => [100, 270]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow3, false);

      // A new container should have been created with HSPLIT
      const containers = nodeWindow3.parentNode;
      expect(containers.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });
  });

  describe("moveWindowToPointer - RIGHT Edge Drop", () => {
    it("should tile window to the right when dragged to right edge", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      // Point to right edge region (70-100% of width)
      global.get_pointer = vi.fn(() => [1800, 540]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      expect(nodeWindow2.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should place dragged window after target when dropping right", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      global.get_pointer = vi.fn(() => [1800, 540]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      // Window 2 should come after window 1 in the tree
      const parent = nodeWindow2.parentNode;
      const children = parent.childNodes.filter((c) => c.nodeType === NODE_TYPES.WINDOW);
      const idx1 = children.indexOf(nodeWindow1);
      const idx2 = children.indexOf(nodeWindow2);
      expect(idx2).toBeGreaterThan(idx1);
    });
  });

  describe("moveWindowToPointer - TOP Edge Drop", () => {
    it("should tile window above target when dragged to top edge", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      // Point to top edge region (0-30% of height)
      global.get_pointer = vi.fn(() => [960, 100]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      // Should create vertical split
      expect(nodeWindow2.parentNode.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should create vertical split container when dropping top in horizontal layout", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow3 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow3
      );
      nodeWindow3.mode = WINDOW_MODES.GRAB_TILE;

      // Point to top edge of window1
      global.get_pointer = vi.fn(() => [480, 100]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow3, false);

      // A new container should have been created with VSPLIT
      expect(nodeWindow3.parentNode.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });
  });

  describe("moveWindowToPointer - BOTTOM Edge Drop", () => {
    it("should tile window below target when dragged to bottom edge", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      // Point to bottom edge region (70-100% of height)
      global.get_pointer = vi.fn(() => [960, 1000]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      expect(nodeWindow2.parentNode.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should place dragged window after target when dropping bottom", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      global.get_pointer = vi.fn(() => [960, 1000]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      const parent = nodeWindow2.parentNode;
      const children = parent.childNodes.filter((c) => c.nodeType === NODE_TYPES.WINDOW);
      const idx1 = children.indexOf(nodeWindow1);
      const idx2 = children.indexOf(nodeWindow2);
      expect(idx2).toBeGreaterThan(idx1);
    });
  });

  describe("moveWindowToPointer - CENTER Drop (SWAP mode)", () => {
    it("should swap windows when center drop with SWAP mode", () => {
      mockSettings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "SWAP";
        return "";
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      // Point to center region (30-70% of both dimensions)
      global.get_pointer = vi.fn(() => [480, 540]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      const swapSpy = vi.spyOn(windowManager.tree, "swapPairs");

      windowManager.moveWindowToPointer(nodeWindow2, false);

      expect(swapSpy).toHaveBeenCalledWith(nodeWindow1, nodeWindow2);
    });
  });

  describe("moveWindowToPointer - CENTER Drop (STACKED mode)", () => {
    it("should create stacked container when center drop with STACKED mode", () => {
      mockSettings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "STACKED";
        return "";
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      global.get_pointer = vi.fn(() => [960, 540]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      // Windows should now share a STACKED container
      expect(nodeWindow2.parentNode.layout).toBe(LAYOUT_TYPES.STACKED);
    });
  });

  describe("moveWindowToPointer - CENTER Drop (TABBED mode)", () => {
    it("should create tabbed container when center drop with TABBED mode", () => {
      mockSettings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "TABBED";
        return "";
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      global.get_pointer = vi.fn(() => [960, 540]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      expect(nodeWindow2.parentNode.layout).toBe(LAYOUT_TYPES.TABBED);
    });
  });

  describe("moveWindowToPointer - Preview Mode", () => {
    it("should not modify tree when preview is true", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "preview-hint-enabled") return true;
        return key === "tiling-mode-enabled";
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;
      nodeWindow2.previewHint = {
        set_style_class_name: vi.fn(),
        set_position: vi.fn(),
        set_size: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };

      global.get_pointer = vi.fn(() => [100, 540]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      const childCountBefore = monitor.childNodes.length;

      windowManager.moveWindowToPointer(nodeWindow2, true);

      // Tree should not be modified in preview mode
      const childCountAfter = monitor.childNodes.length;
      expect(childCountAfter).toBe(childCountBefore);
    });

    it("should show preview hint when dragging", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "preview-hint-enabled") return true;
        return key === "tiling-mode-enabled";
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      const previewHint = {
        set_style_class_name: vi.fn(),
        set_position: vi.fn(),
        set_size: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      nodeWindow2.previewHint = previewHint;

      global.get_pointer = vi.fn(() => [100, 540]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, true);

      expect(previewHint.show).toHaveBeenCalled();
    });
  });

  describe("moveWindowToPointer - Stacked Container Edge Drops", () => {
    it("should detach window from stacked container when dropping on left edge", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow3 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.STACKED;

      // Create stacked windows
      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow3
      );
      nodeWindow3.mode = WINDOW_MODES.GRAB_TILE;

      // Point to left edge
      global.get_pointer = vi.fn(() => [100, 540]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      const splitSpy = vi.spyOn(windowManager.tree, "split");

      windowManager.moveWindowToPointer(nodeWindow3, false);

      // Should have called split to detach window
      expect(splitSpy).toHaveBeenCalled();
    });

    it("should keep stacked container valid after window detachment", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow3 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.STACKED;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      const nodeWindow3 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow3
      );
      nodeWindow3.mode = WINDOW_MODES.GRAB_TILE;

      // Set detachWindow flag
      nodeWindow3.detachWindow = true;

      global.get_pointer = vi.fn(() => [100, 540]);
      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow3, false);

      // Remaining stacked windows should still have valid parent
      expect(nodeWindow1.parentNode).not.toBeNull();
      expect(nodeWindow2.parentNode).not.toBeNull();
    });
  });

  describe("moveWindowToPointer - Edge Cases", () => {
    it("should do nothing when dropping window onto itself", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.GRAB_TILE;

      global.get_pointer = vi.fn(() => [960, 540]);

      // Window pointing to itself
      windowManager.nodeWinAtPointer = nodeWindow1;

      const initialParent = nodeWindow1.parentNode;
      const initialChildCount = initialParent.childNodes.length;

      windowManager.moveWindowToPointer(nodeWindow1, false);

      // Nothing should change
      expect(nodeWindow1.parentNode).toBe(initialParent);
      expect(initialParent.childNodes.length).toBe(initialChildCount);
    });

    it("should handle drop target with missing parent gracefully", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      // Create invalid nodeWinAtPointer with valid nodeValue but invalid parent
      windowManager.nodeWinAtPointer = {
        nodeValue: metaWindow1,
        parentNode: { childNodes: null }, // Invalid parent structure
      };

      global.get_pointer = vi.fn(() => [960, 540]);

      // Should not throw
      expect(() => windowManager.moveWindowToPointer(nodeWindow2, false)).not.toThrow();
    });
  });

  describe("canMovePointerInsideNodeWindow", () => {
    it("should return false when nodeWindow is null", () => {
      expect(windowManager.canMovePointerInsideNodeWindow(null)).toBe(false);
    });

    it("should return false when nodeWindow has no _data", () => {
      expect(windowManager.canMovePointerInsideNodeWindow({})).toBe(false);
    });

    it("should return false when window is minimized", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
      });
      metaWindow.minimized = true;

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      expect(windowManager.canMovePointerInsideNodeWindow(nodeWindow)).toBe(false);
    });

    it("should return false when pointer is already inside window", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      // Pointer inside window bounds
      global.get_pointer = vi.fn(() => [960, 540]);

      expect(windowManager.canMovePointerInsideNodeWindow(nodeWindow)).toBe(false);
    });

    it("should return false for tiny windows (likely capture windows)", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1, height: 1 }),
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      global.get_pointer = vi.fn(() => [100, 100]);

      expect(windowManager.canMovePointerInsideNodeWindow(nodeWindow)).toBe(false);
    });
  });

  describe("pointerIsOverParentDecoration", () => {
    it("should return false when pointerCoord is null", () => {
      const metaWindow = createMockWindow();
      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      expect(windowManager.pointerIsOverParentDecoration(nodeWindow, null)).toBe(false);
    });

    it("should return false when nodeWindow is null", () => {
      expect(windowManager.pointerIsOverParentDecoration(null, [960, 540])).toBe(false);
    });

    it("should return false when parent is not stacked or tabbed", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      expect(windowManager.pointerIsOverParentDecoration(nodeWindow, [960, 540])).toBe(false);
    });
  });

  describe("Region Detection", () => {
    it("should detect left region correctly (0-30% of width)", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1000, height: 1000 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1000, height: 1000 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      // Point at 29% of width (within left region)
      global.get_pointer = vi.fn(() => [290, 500]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      expect(nodeWindow2.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should detect right region correctly (70-100% of width)", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1000, height: 1000 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1000, height: 1000 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      // Point at 71% of width (within right region)
      global.get_pointer = vi.fn(() => [710, 500]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      windowManager.moveWindowToPointer(nodeWindow2, false);

      expect(nodeWindow2.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should detect center region correctly (30-70% of both dimensions)", () => {
      mockSettings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "SWAP";
        return "";
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1000, height: 1000 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1000, height: 1000 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.GRAB_TILE;

      // Point at 50% of both dimensions (center region)
      global.get_pointer = vi.fn(() => [500, 500]);

      windowManager.nodeWinAtPointer = nodeWindow1;

      const swapSpy = vi.spyOn(windowManager.tree, "swapPairs");

      windowManager.moveWindowToPointer(nodeWindow2, false);

      expect(swapSpy).toHaveBeenCalled();
    });
  });
});
