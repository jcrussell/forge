import { describe, it, expect, beforeEach, vi } from "vitest";
import { Tree, Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * Bug #40: Deeply nested nodes with minimized windows cause focus issues
 *
 * Problem: When containers have minimized windows, focus() can navigate to them
 * instead of skipping to visible windows. This creates confusing navigation behavior.
 *
 * Root Cause: The focus() function filtered for tiled windows but not for
 * non-minimized windows. A minimized window can still be in tiled mode.
 *
 * Fix: Added !w.nodeValue.minimized filter in focus() at lines 795-797 and 823-826.
 */
describe("Bug #40: Minimized windows in focus navigation", () => {
  let tree;
  let mockExtWm;
  let mockWorkspaceManager;
  let monitorNode;

  beforeEach(() => {
    // Mock global
    global.display = {
      get_workspace_manager: vi.fn(),
      get_n_monitors: vi.fn(() => 1),
      get_focus_window: vi.fn(() => null),
      get_current_monitor: vi.fn(() => 0),
      get_current_time: vi.fn(() => 12345),
      get_monitor_geometry: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      get_monitor_neighbor_index: vi.fn(() => -1),
    };

    global.window_group = {
      contains: vi.fn(() => false),
      add_child: vi.fn(),
      remove_child: vi.fn(),
    };

    global.get_current_time = vi.fn(() => 12345);

    // Mock workspace manager
    mockWorkspaceManager = {
      get_n_workspaces: vi.fn(() => 1),
      get_workspace_by_index: vi.fn((i) => ({
        index: () => i,
      })),
    };

    global.display.get_workspace_manager.mockReturnValue(mockWorkspaceManager);

    // Mock WindowManager
    mockExtWm = {
      ext: {
        settings: {
          get_boolean: vi.fn((key) => {
            if (key === "move-pointer-focus-enabled") return false;
            return false;
          }),
          get_uint: vi.fn(() => 0),
        },
      },
      determineSplitLayout: vi.fn(() => LAYOUT_TYPES.HSPLIT),
      bindWorkspaceSignals: vi.fn(),
      movePointerWith: vi.fn(),
      move: vi.fn(),
      currentMonWsNode: null,
      rectForMonitor: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      floatingWindow: vi.fn(() => false),
      getPointer: vi.fn(() => [960, 540]),
    };

    // Create tree
    tree = new Tree(mockExtWm);

    // Setup tree structure - get workspace and monitor from tree
    const workspace = tree.nodeWorkpaces[0];
    monitorNode = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
    monitorNode.layout = LAYOUT_TYPES.HSPLIT;
    monitorNode.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    // Make current monitor node available
    mockExtWm.currentMonWsNode = monitorNode;
  });

  describe("Focus should skip minimized windows in containers", () => {
    it("should skip minimized window when navigating right in HSPLIT", () => {
      // Setup: [ A ] [ B(minimized) ] [ C ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowB.minimized = true;

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Focus right from A should skip B (minimized) and go to C
      const result = tree.focus(nodeA, MotionDirection.RIGHT);

      expect(result).toBe(nodeC);
    });

    it("should skip minimized window when navigating left in HSPLIT", () => {
      // Setup: [ A ] [ B(minimized) ] [ C ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowB.minimized = true;

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Focus left from C should skip B (minimized) and go to A
      const result = tree.focus(nodeC, MotionDirection.LEFT);

      expect(result).toBe(nodeA);
    });
  });

  describe("Focus into container with minimized windows", () => {
    it("should skip minimized windows when focusing into a container", () => {
      // Setup: [ A ] [ container[ B(minimized), C ] ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowB.minimized = true;

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      nodeA.mode = WINDOW_MODES.TILE;

      // Create container with B (minimized) and C
      const container = new Node(NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;
      monitorNode.appendChild(container);

      const nodeB = new Node(NODE_TYPES.WINDOW, windowB);
      const nodeC = new Node(NODE_TYPES.WINDOW, windowC);
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;
      container.appendChild(nodeB);
      container.appendChild(nodeC);

      // Focus right from A should go into container and select C (not B which is minimized)
      const result = tree.focus(nodeA, MotionDirection.RIGHT);

      expect(result).toBe(nodeC);
    });

    it("should select last non-minimized window when focusing backward into container", () => {
      // Setup: [ container[ A, B(minimized) ] ] [ C ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowB.minimized = true;

      // Create container with A and B (minimized)
      const container = new Node(NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;
      monitorNode.appendChild(container);

      const nodeA = new Node(NODE_TYPES.WINDOW, windowA);
      const nodeB = new Node(NODE_TYPES.WINDOW, windowB);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      container.appendChild(nodeA);
      container.appendChild(nodeB);

      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeC.mode = WINDOW_MODES.TILE;

      // Focus left from C should go into container and select A (B is minimized)
      const result = tree.focus(nodeC, MotionDirection.LEFT);

      expect(result).toBe(nodeA);
    });
  });

  describe("Container with all windows minimized", () => {
    it("should return null when all windows in container are minimized", () => {
      // Setup: [ A ] [ container[ B(minimized), C(minimized) ] ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowB.minimized = true;
      windowC.minimized = true;

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      nodeA.mode = WINDOW_MODES.TILE;

      // Create container with all minimized windows
      const container = new Node(NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;
      monitorNode.appendChild(container);

      const nodeB = new Node(NODE_TYPES.WINDOW, windowB);
      const nodeC = new Node(NODE_TYPES.WINDOW, windowC);
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;
      container.appendChild(nodeB);
      container.appendChild(nodeC);

      // Focus right from A into container with all minimized windows
      const result = tree.focus(nodeA, MotionDirection.RIGHT);

      // Should return null or undefined since there are no visible windows to focus
      expect(result == null).toBe(true);
    });
  });

  describe("Vertical layout with minimized windows", () => {
    it("should skip minimized window when navigating down in VSPLIT", () => {
      // Setup: [ A ]
      //        [ B(minimized) ]
      //        [ C ]
      monitorNode.layout = LAYOUT_TYPES.VSPLIT;

      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowB.minimized = true;

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Focus down from A should skip B (minimized) and go to C
      const result = tree.focus(nodeA, MotionDirection.DOWN);

      expect(result).toBe(nodeC);
    });

    it("should skip minimized window when navigating up in VSPLIT", () => {
      // Setup: [ A ]
      //        [ B(minimized) ]
      //        [ C ]
      monitorNode.layout = LAYOUT_TYPES.VSPLIT;

      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowB.minimized = true;

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Focus up from C should skip B (minimized) and go to A
      const result = tree.focus(nodeC, MotionDirection.UP);

      expect(result).toBe(nodeA);
    });
  });

  describe("Edge cases", () => {
    it("should handle non-minimized windows normally", () => {
      // Setup: [ A ] [ B ] [ C ] - none minimized
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Focus right from A should go to B (not minimized)
      const result = tree.focus(nodeA, MotionDirection.RIGHT);

      expect(result).toBe(nodeB);
    });

    it("should handle first window minimized", () => {
      // Setup: [ A(minimized) ] [ B ] [ C ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowA.minimized = true;

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Focus left from C should go to B (A is minimized)
      const result = tree.focus(nodeC, MotionDirection.LEFT);

      expect(result).toBe(nodeB);
    });

    it("should handle last window minimized", () => {
      // Setup: [ A ] [ B ] [ C(minimized) ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowC.minimized = true;

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Focus right from A should go to B (C is minimized, but we hit B first)
      const result = tree.focus(nodeA, MotionDirection.RIGHT);

      expect(result).toBe(nodeB);
    });
  });
});
