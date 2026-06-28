import { describe, it, expect, beforeEach, vi } from "vitest";
import St from "gi://St";
import {
  Tree,
  Node,
  NODE_TYPES,
  LAYOUT_TYPES,
  ORIENTATION_TYPES,
} from "../../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Bin } from "../../mocks/gnome/St.js";
import { MotionDirection } from "../../mocks/gnome/Meta.js";

/**
 * Tree manipulation operations tests
 *
 * Tests for move, swap, split, and navigation operations
 */
describe("Tree Operations", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    // Setup currentMonWsNode for tests
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
  });

  describe("next", () => {
    it("should find next sibling to the right", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      const next = ctx.tree.next(node1, MotionDirection.RIGHT);

      expect(next).toBe(node2);
    });

    it("should find next sibling to the left", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      const next = ctx.tree.next(node2, MotionDirection.LEFT);

      expect(next).toBe(node1);
    });

    it("should find next sibling downward", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      const next = ctx.tree.next(node1, MotionDirection.DOWN);

      expect(next).toBe(node2);
    });

    it("should find next sibling upward", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      const next = ctx.tree.next(node2, MotionDirection.UP);

      expect(next).toBe(node1);
    });

    it("should return null for node at end", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      const next = ctx.tree.next(node, MotionDirection.RIGHT);

      // A lone window at the end of an HSPLIT has no rightward neighbor; next()
      // returns the -1 end-of-list sentinel (toBeDefined() also passed for null
      // or any node, so it could never fail — assert the real contract).
      expect(next).toBe(-1);
    });

    it("should navigate across different orientations", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.VSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      // Try to navigate from container to sibling
      const next = ctx.tree.next(container, MotionDirection.RIGHT);

      expect(next).toBe(node2);
    });
  });

  describe("split", () => {
    it("should create horizontal split container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.split(node, ORIENTATION_TYPES.HORIZONTAL, true);

      // Node should now be inside a container
      expect(node.parentNode.nodeType).toBe(NODE_TYPES.CON);
      expect(node.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should create vertical split container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.split(node, ORIENTATION_TYPES.VERTICAL, true);

      // Node should now be inside a container
      expect(node.parentNode.nodeType).toBe(NODE_TYPES.CON);
      expect(node.parentNode.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should toggle split direction if single child", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;

      const window = createMockWindow();
      const node = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window);

      // Split should toggle the parent layout
      ctx.tree.split(node, ORIENTATION_TYPES.VERTICAL, false);

      expect(container.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should not toggle if forceSplit is true", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;

      const window = createMockWindow();
      const node = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.split(node, ORIENTATION_TYPES.VERTICAL, true);

      // Should create new container instead of toggling
      expect(node.parentNode.layout).toBe(LAYOUT_TYPES.VSPLIT);
      expect(node.parentNode.parentNode).toBe(container);
    });

    it("should ignore floating windows", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);
      node.mode = WINDOW_MODES.FLOAT;

      const parentBefore = node.parentNode;
      ctx.tree.split(node, ORIENTATION_TYPES.HORIZONTAL);

      // Should not have changed
      expect(node.parentNode).toBe(parentBefore);
    });

    it("should preserve node rect and percent", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);
      node.rect = { x: 100, y: 100, width: 500, height: 500 };
      node.percent = 0.6;

      ctx.tree.split(node, ORIENTATION_TYPES.HORIZONTAL, true);

      const container = node.parentNode;
      expect(container.rect).toEqual({ x: 100, y: 100, width: 500, height: 500 });
      expect(container.percent).toBe(0.6);
    });

    it("should set attachNode to new container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.split(node, ORIENTATION_TYPES.HORIZONTAL, true);

      expect(ctx.tree.attachNode).toBe(node.parentNode);
    });
  });

  describe("swapPairs", () => {
    it("should swap two windows in same parent", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;

      // Store original indexes
      const index1Before = node1.index;
      const index2Before = node2.index;

      ctx.tree.swapPairs(node1, node2, false);

      // Indexes should be swapped
      expect(node1.index).toBe(index2Before);
      expect(node2.index).toBe(index1Before);
    });

    it("should swap windows in different parents", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const container2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(container1.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window2);

      ctx.tree.swapPairs(node1, node2, false);

      // Parents should be swapped
      expect(node1.parentNode).toBe(container2);
      expect(node2.parentNode).toBe(container1);
    });

    it("should exchange modes", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.FLOAT;

      ctx.tree.swapPairs(node1, node2, false);

      expect(node1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(node2.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should exchange percents", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.percent = 0.7;
      node2.percent = 0.3;

      ctx.tree.swapPairs(node1, node2, false);

      expect(node1.percent).toBe(0.3);
      expect(node2.percent).toBe(0.7);
    });

    it("should call WindowManager.move for both windows", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      ctx.tree.swapPairs(node1, node2, false);

      expect(ctx.extWm.move).toHaveBeenCalledTimes(2);
    });

    it("should focus first window if focus=true", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      const raiseSpy = vi.spyOn(window1, "raise");
      const focusSpy = vi.spyOn(window1, "focus");

      ctx.tree.swapPairs(node1, node2, true);

      expect(raiseSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it("should not swap if first node not swappable", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow({ minimized: true });
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      const parentBefore = node1.parentNode;
      ctx.tree.swapPairs(node1, node2, false);

      // Should not have swapped
      expect(node1.parentNode).toBe(parentBefore);
    });

    it("should not swap if second node not swappable", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow({ minimized: true });
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      const parentBefore = node1.parentNode;
      ctx.tree.swapPairs(node1, node2, false);

      // Should not have swapped
      expect(node1.parentNode).toBe(parentBefore);
    });

    // forge-u7q6: destructive-op guard branches.
    it("is a structural no-op when swapping a node with itself", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;

      const childrenBefore = [...monitor.childNodes];
      const indexBefore = node1.index;

      // Same node as both args: the swap writes node1 back into its own slot,
      // so the parent's child array must keep its identity/order (no duplicated
      // or dropped reference) and node1 keeps its index.
      ctx.tree.swapPairs(node1, node1, false);

      expect(node1.index).toBe(indexBefore);
      expect(node1.parentNode).toBe(monitor);
      expect(monitor.childNodes).toEqual(childrenBefore);
    });

    it("skips the swap when the fromNode window is dead (isWindowAlive guard)", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);
      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;

      // A finalized MetaWindow throws on any method call; isWindowAlive probes
      // get_id(), so a throwing get_id() marks node1's window as dead.
      window1.get_id = () => {
        throw new Error("Object Meta.Window has been already deallocated");
      };

      const parent1Before = node1.parentNode;
      const parent2Before = node2.parentNode;
      ctx.extWm.move.mockClear();

      ctx.tree.swapPairs(node1, node2, false);

      // Guard returns before any structural change or move().
      expect(node1.parentNode).toBe(parent1Before);
      expect(node2.parentNode).toBe(parent2Before);
      expect(ctx.extWm.move).not.toHaveBeenCalled();
    });

    it("skips the swap when the toNode window is dead (isWindowAlive guard)", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);
      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;

      window2.get_id = () => {
        throw new Error("Object Meta.Window has been already deallocated");
      };

      const parent1Before = node1.parentNode;
      const parent2Before = node2.parentNode;
      ctx.extWm.move.mockClear();

      ctx.tree.swapPairs(node1, node2, false);

      expect(node1.parentNode).toBe(parent1Before);
      expect(node2.parentNode).toBe(parent2Before);
      expect(ctx.extWm.move).not.toHaveBeenCalled();
    });
  });

  describe("swap", () => {
    it("should swap with next window to the right", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;

      const result = ctx.tree.swap(node1, MotionDirection.RIGHT);

      expect(result).toBe(node2);
    });

    it("should swap with first window in container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      node1.mode = WINDOW_MODES.TILE;

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;

      const window2 = createMockWindow();
      const window3 = createMockWindow();
      const node2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      const node3 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      node2.mode = WINDOW_MODES.TILE;
      node3.mode = WINDOW_MODES.TILE;

      const result = ctx.tree.swap(node1, MotionDirection.RIGHT);

      // Should swap with first window in container
      expect(result).toBe(node2);
    });

    it("should swap with last window in stacked container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      node1.mode = WINDOW_MODES.TILE;

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.STACKED;

      const window2 = createMockWindow();
      const window3 = createMockWindow();
      const node2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      const node3 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      node2.mode = WINDOW_MODES.TILE;
      node3.mode = WINDOW_MODES.TILE;

      const result = ctx.tree.swap(node1, MotionDirection.RIGHT);

      // Should swap with last window in stacked container
      expect(result).toBe(node3);
    });

    it("should return undefined if no next node", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      // Mock next to return null
      vi.spyOn(ctx.tree, "next").mockReturnValue(null);

      const result = ctx.tree.swap(node, MotionDirection.RIGHT);

      expect(result).toBeUndefined();
    });

    it("should return undefined if nodes not in same monitor", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;

      // Mock sameParentMonitor to return false
      ctx.extWm.sameParentMonitor.mockReturnValue(false);

      const result = ctx.tree.swap(node1, MotionDirection.RIGHT);

      expect(result).toBeUndefined();
    });
  });

  describe("move", () => {
    it("should move window to the right", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const window3 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);
      const node3 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window3);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;
      node3.mode = WINDOW_MODES.TILE;

      // Move node1 to the right (should swap with node2)
      const result = ctx.tree.move(node1, MotionDirection.RIGHT);

      expect(result).toBe(true);
      // node1 should now be at index 1 (swapped with node2)
      expect(node1.index).toBe(1);
    });

    it("should move window to the left", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;

      // Move node2 to the left (should swap with node1)
      const result = ctx.tree.move(node2, MotionDirection.LEFT);

      expect(result).toBe(true);
      expect(node2.index).toBe(0);
    });

    it("should swap sibling positions when moving into occupied space", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;

      // Verify initial indices
      const initialIndex1 = node1.index;
      const initialIndex2 = node2.index;
      expect(initialIndex1).toBe(0);
      expect(initialIndex2).toBe(1);

      ctx.tree.move(node1, MotionDirection.RIGHT);

      // After move, indices should be swapped
      expect(node1.index).toBe(initialIndex2);
      expect(node2.index).toBe(initialIndex1);
    });

    it("should move window into container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      node1.mode = WINDOW_MODES.TILE;

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;

      const window2 = createMockWindow();
      const node2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      node2.mode = WINDOW_MODES.TILE;

      ctx.tree.move(node1, MotionDirection.RIGHT);

      // node1 should now be inside container
      expect(node1.parentNode).toBe(container);
    });

    it("should swap window percentages when swapping adjacent siblings", () => {
      // When swapping adjacent siblings, the percentages are exchanged
      // so each position retains its size allocation
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.TILE;

      // Set specific percentages before swap
      node1.percent = 0.4;
      node2.percent = 0.6;

      ctx.tree.move(node1, MotionDirection.RIGHT);

      // Percentages should be exchanged (each position keeps its size)
      expect(node1.percent).toBe(0.6);
      expect(node2.percent).toBe(0.4);
    });

    it("should return false if no next node", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      // Mock next to return null
      vi.spyOn(ctx.tree, "next").mockReturnValue(null);

      const result = ctx.tree.move(node, MotionDirection.RIGHT);

      expect(result).toBe(false);
    });

    it("should handle moving into stacked container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      node1.mode = WINDOW_MODES.TILE;

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.STACKED;

      const window2 = createMockWindow();
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      ctx.tree.move(node1, MotionDirection.RIGHT);

      // Should be appended to stacked container
      expect(node1.parentNode).toBe(container);
      expect(node1).toBe(container.lastChild);
    });
  });

  describe("next - Stacked Container Navigation", () => {
    it("should cycle through windows in stacked container using UP/DOWN", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.STACKED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const window3 = createMockWindow();
      const node1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      const node3 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      // Navigate down from first window
      const nextFromFirst = ctx.tree.next(node1, MotionDirection.DOWN);
      expect(nextFromFirst).toBe(node2);

      // Navigate down from second window
      const nextFromSecond = ctx.tree.next(node2, MotionDirection.DOWN);
      expect(nextFromSecond).toBe(node3);
    });

    it("should navigate up in stacked container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.STACKED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      // Navigate up from second window
      const prev = ctx.tree.next(node2, MotionDirection.UP);
      expect(prev).toBe(node1);
    });

    it("should exit stacked container when navigating left/right", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.STACKED;

      const window1 = createMockWindow();
      const node1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);

      const window2 = createMockWindow();
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      // Navigate right from stacked container should exit to sibling
      const nextRight = ctx.tree.next(node1, MotionDirection.RIGHT);
      expect(nextRight).toBe(node2);
    });
  });

  describe("next - Tabbed Container Navigation", () => {
    it("should cycle through tabs using LEFT/RIGHT", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.TABBED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const window3 = createMockWindow();
      const node1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      const node3 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      // Navigate right from first tab
      const nextFromFirst = ctx.tree.next(node1, MotionDirection.RIGHT);
      expect(nextFromFirst).toBe(node2);

      // Navigate right from second tab
      const nextFromSecond = ctx.tree.next(node2, MotionDirection.RIGHT);
      expect(nextFromSecond).toBe(node3);
    });

    it("should navigate left between tabs", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.TABBED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      // Navigate left from second tab
      const prev = ctx.tree.next(node2, MotionDirection.LEFT);
      expect(prev).toBe(node1);
    });

    it("should exit tabbed container when navigating up/down", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.TABBED;

      const window1 = createMockWindow();
      const node1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);

      const window2 = createMockWindow();
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      // Navigate down from tabbed container should exit to sibling
      const nextDown = ctx.tree.next(node1, MotionDirection.DOWN);
      expect(nextDown).toBe(node2);
    });
  });

  describe("next - Cross-Container Navigation", () => {
    it("should navigate from one container to another container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const container1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container1.layout = LAYOUT_TYPES.VSPLIT;

      const container2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container2.layout = LAYOUT_TYPES.VSPLIT;

      const window1 = createMockWindow();
      const node1 = ctx.tree.createNode(container1.nodeValue, NODE_TYPES.WINDOW, window1);

      const window2 = createMockWindow();
      ctx.tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window2);

      // Navigate right from window in container1 - returns the sibling container
      const next = ctx.tree.next(node1, MotionDirection.RIGHT);
      // The next() function returns the container or its first window depending on layout
      expect(next).toBeDefined();
      expect(next.parentNode === monitor || next.parentNode.parentNode === monitor).toBe(true);
    });

    it("should navigate into container and find appropriate node", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.VSPLIT;

      const window2 = createMockWindow();
      const window3 = createMockWindow();
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      // Navigate right from window1 should go to the container or its first window
      const next = ctx.tree.next(node1, MotionDirection.RIGHT);
      expect(next).toBeDefined();
      // Either we get the container or a window inside it
      expect(next === container || next.nodeType === NODE_TYPES.WINDOW).toBe(true);
    });

    it("should navigate into stacked container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const window1 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.STACKED;

      const window2 = createMockWindow();
      const window3 = createMockWindow();
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      // Navigate right from window1 should enter the stacked container
      const next = ctx.tree.next(node1, MotionDirection.RIGHT);
      expect(next).toBeDefined();
      // Either we get the container or a window inside it
      expect(next === container || next.parentNode === container).toBe(true);
    });
  });

  // forge-zrl: cyclic, non-directional focus/swap among tiled siblings.
  describe("cyclic focus/swap siblings", () => {
    let monitor, n1, n2, n3;

    beforeEach(() => {
      ({ monitor } = getWorkspaceAndMonitor(ctx));
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      n1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
      n2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
      n3 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
    });

    it("focuses the next sibling", () => {
      expect(ctx.tree.focusSibling(n1, 1)).toBe(n2);
    });

    it("wraps from the last sibling to the first when focusing next", () => {
      expect(ctx.tree.focusSibling(n3, 1)).toBe(n1);
    });

    it("wraps from the first sibling to the last when focusing previous", () => {
      expect(ctx.tree.focusSibling(n1, -1)).toBe(n3);
    });

    it("returns null when there is only one tiled sibling", () => {
      const solo = createTreeFixture({ fullExtWm: true });
      const { monitor: m } = getWorkspaceAndMonitor(solo);
      const only = solo.tree.createNode(m.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
      expect(solo.tree.focusSibling(only, 1)).toBeNull();
      solo.cleanup();
    });

    it("skips floating siblings when cycling", () => {
      n2.mode = WINDOW_MODES.FLOAT;
      // From n1, next tiled sibling skips the floating n2 and lands on n3.
      expect(ctx.tree.focusSibling(n1, 1)).toBe(n3);
    });

    it("swaps with the next sibling and returns the moved node", () => {
      const before = monitor.childNodes.indexOf(n1);
      expect(ctx.tree.swapSibling(n1, 1)).toBe(n1);
      // n1 and n2 exchanged positions in the parent.
      expect(monitor.childNodes.indexOf(n1)).toBe(before + 1);
      expect(monitor.childNodes[before]).toBe(n2);
    });

    it("returns null from swapSibling when there is no valid target", () => {
      const solo = createTreeFixture({ fullExtWm: true });
      const { monitor: m } = getWorkspaceAndMonitor(solo);
      const only = solo.tree.createNode(m.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
      expect(solo.tree.swapSibling(only, 1)).toBeNull();
      solo.cleanup();
    });
  });
});
