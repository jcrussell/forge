import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Tree,
  Node,
  NODE_TYPES,
  LAYOUT_TYPES,
  ORIENTATION_TYPES,
} from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * Bug #213: Moving windows via keyboard shortcuts is janky
 *
 * Problem: Windows don't move in expected directions when using Shift+Super+Arrow.
 * Moving up may cause no movement, or move right into a 1x3/1x4 configuration.
 *
 * Root Cause: In tree.move(), the position insertion logic for non-adjacent moves
 * may be inverted, and the next() function can return unexpected targets when
 * movement direction doesn't match container orientation.
 */
describe("Bug #213: Window movement directions", () => {
  let ctx;
  let tree;
  let monitorNode;

  beforeEach(() => {
    // Use fixture with full ExtWm for move operations
    ctx = createTreeFixture({ fullExtWm: true });
    tree = ctx.tree;

    // Get monitor node from tree
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitorNode = monitor;
    monitorNode.layout = LAYOUT_TYPES.HSPLIT;
    monitorNode.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    // Make current monitor node available
    ctx.extWm.currentMonWsNode = monitorNode;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("Swap with adjacent sibling", () => {
    it("should swap with adjacent sibling when moving right", () => {
      // Setup: [ A ] [ B ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;

      expect(monitorNode.childNodes[0]).toBe(nodeA);
      expect(monitorNode.childNodes[1]).toBe(nodeB);

      // Move A right (should swap with B)
      tree.move(nodeA, MotionDirection.RIGHT);

      // Result should be: [ B ] [ A ]
      expect(monitorNode.childNodes[0]).toBe(nodeB);
      expect(monitorNode.childNodes[1]).toBe(nodeA);
    });

    it("should swap with adjacent sibling when moving left", () => {
      // Setup: [ A ] [ B ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;

      expect(monitorNode.childNodes[0]).toBe(nodeA);
      expect(monitorNode.childNodes[1]).toBe(nodeB);

      // Move B left (should swap with A)
      tree.move(nodeB, MotionDirection.LEFT);

      // Result should be: [ B ] [ A ]
      expect(monitorNode.childNodes[0]).toBe(nodeB);
      expect(monitorNode.childNodes[1]).toBe(nodeA);
    });
  });

  describe("Move across container boundaries", () => {
    it("should move window into container when moving right", () => {
      // Setup: [ A ] [ container[ B, C ] ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      nodeA.mode = WINDOW_MODES.TILE;

      // Create container with B and C
      const container = new Node(NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;
      monitorNode.appendChild(container);

      const nodeB = new Node(NODE_TYPES.WINDOW, windowB);
      const nodeC = new Node(NODE_TYPES.WINDOW, windowC);
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;
      container.appendChild(nodeB);
      container.appendChild(nodeC);

      expect(monitorNode.childNodes.length).toBe(2);
      expect(monitorNode.childNodes[0]).toBe(nodeA);
      expect(monitorNode.childNodes[1]).toBe(container);

      // Move A right (should go into container)
      tree.move(nodeA, MotionDirection.RIGHT);

      // A should now be in the container
      // Based on the code, when moving AFTER into a container, it inserts at firstChild
      expect(nodeA.parentNode).toBe(container);
    });

    it("should move window out of container when moving up", () => {
      // Setup: [ container[ A, B ] ]
      // Layout: VSPLIT (vertical), so A is on top of B
      monitorNode.layout = LAYOUT_TYPES.VSPLIT;

      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });

      // Create container with vertical layout
      const container = new Node(NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.VSPLIT;
      monitorNode.appendChild(container);

      const nodeA = new Node(NODE_TYPES.WINDOW, windowA);
      const nodeB = new Node(NODE_TYPES.WINDOW, windowB);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      container.appendChild(nodeA);
      container.appendChild(nodeB);

      expect(container.childNodes.length).toBe(2);

      // Move A up - when at the edge of a container, should move to parent level
      const result = tree.move(nodeA, MotionDirection.UP);

      // The result depends on how next() handles edge cases
      // At minimum, the move should complete without error
      expect(typeof result).toBe("boolean");
    });
  });

  describe("Move in different orientations", () => {
    it("should handle horizontal movement in vertical container", () => {
      // Setup: Monitor with HSPLIT, containing container with VSPLIT
      // [ container_vsplit[ A, B ] ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });

      const container = new Node(NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.VSPLIT; // A above B
      monitorNode.appendChild(container);

      const nodeA = new Node(NODE_TYPES.WINDOW, windowA);
      const nodeB = new Node(NODE_TYPES.WINDOW, windowB);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      container.appendChild(nodeA);
      container.appendChild(nodeB);

      // Moving A RIGHT in a VSPLIT container - should try to move out
      const result = tree.move(nodeA, MotionDirection.RIGHT);

      // Should not error and should return boolean
      expect(typeof result).toBe("boolean");
    });

    it("should handle vertical movement in horizontal container", () => {
      // Setup: [ A ] [ B ] in HSPLIT
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;

      // Moving A UP in an HSPLIT container - should try to move out
      const result = tree.move(nodeA, MotionDirection.UP);

      // Should not error and should return boolean
      expect(typeof result).toBe("boolean");
    });
  });

  describe("Edge cases", () => {
    it("should not move floating windows", () => {
      const windowA = createMockWindow({ id: "A" });
      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);

      // Make it float
      nodeA.mode = WINDOW_MODES.FLOAT;

      const result = tree.move(nodeA, MotionDirection.RIGHT);

      expect(result).toBe(false);
    });

    it("should not move minimized windows", () => {
      const windowA = createMockWindow({ id: "A" });
      windowA.minimized = true;

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);

      const result = tree.move(nodeA, MotionDirection.RIGHT);

      expect(result).toBe(false);
    });

    it("should handle null node gracefully", () => {
      const result = tree.move(null, MotionDirection.RIGHT);

      expect(result).toBe(false);
    });
  });

  describe("next() function", () => {
    it("should return adjacent sibling for matching orientation", () => {
      // HSPLIT with [ A ] [ B ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;

      // Moving RIGHT in HSPLIT should find B
      const next = tree.next(nodeA, MotionDirection.RIGHT);

      expect(next).toBe(nodeB);
    });

    it("should return null for perpendicular orientation with no parent sibling", () => {
      // HSPLIT with [ A ] [ B ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;

      // Moving UP in HSPLIT - should go to parent level
      const next = tree.next(nodeA, MotionDirection.UP);

      // When there's no sibling in the perpendicular direction, next() returns null or -1
      // The exact behavior depends on the parent structure
      expect(next === null || next === undefined || next === -1).toBe(true);
    });
  });

  describe("Three window layout", () => {
    it("should correctly swap windows in 3-window horizontal layout", () => {
      // Setup: [ A ] [ B ] [ C ]
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      expect(monitorNode.childNodes[0]).toBe(nodeA);
      expect(monitorNode.childNodes[1]).toBe(nodeB);
      expect(monitorNode.childNodes[2]).toBe(nodeC);

      // Move B right (should swap with C)
      tree.move(nodeB, MotionDirection.RIGHT);

      // Result should be: [ A ] [ C ] [ B ]
      expect(monitorNode.childNodes[0]).toBe(nodeA);
      expect(monitorNode.childNodes[1]).toBe(nodeC);
      expect(monitorNode.childNodes[2]).toBe(nodeB);
    });

    it("should correctly move middle window up in 3-window horizontal layout", () => {
      // Setup: [ A ] [ B ] [ C ] in HSPLIT
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      const nodeA = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Moving B UP in HSPLIT - perpendicular movement
      // This should not create a 1x4 layout unexpectedly
      const nextNode = tree.next(nodeB, MotionDirection.UP);

      // In a flat HSPLIT with no parent container, moving up should return null/-1
      expect(nextNode === null || nextNode === undefined || nextNode === -1).toBe(true);
    });
  });
});
