import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-j9fo: swapPairs transfers GRAB_TILE to the stationary swap target.
 *
 * Drag-drop center swap calls swapPairs(referenceNode, draggedNode). swapPairs
 * exchanges the pair's modes, so the stationary referenceNode receives the
 * dragged node's GRAB_TILE while the dragged node becomes TILE. _grabCleanup only
 * resets the dragged node, so the reference node is stranded in GRAB_TILE (excluded
 * from tiling, forces equal splits). Masked today only by forge-te9o's clobber.
 *
 * Fix: swapPairs normalizes GRAB_TILE -> TILE so neither node keeps GRAB_TILE,
 * while still exchanging TILE/FLOAT modes as before.
 */
describe("Bug forge-j9fo: swapPairs never leaves a node in GRAB_TILE", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
  });

  afterEach(() => ctx.cleanup());

  it("normalizes a transferred GRAB_TILE mode to TILE", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const reference = createMockWindow({ id: 2001 });
    const dragged = createMockWindow({ id: 2002 });
    const referenceNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, reference);
    const draggedNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dragged);

    referenceNode.mode = WINDOW_MODES.TILE;
    draggedNode.mode = WINDOW_MODES.GRAB_TILE;

    ctx.tree.swapPairs(referenceNode, draggedNode, false);

    expect(referenceNode.isGrabTile()).toBe(false);
    expect(draggedNode.isGrabTile()).toBe(false);
  });
});
