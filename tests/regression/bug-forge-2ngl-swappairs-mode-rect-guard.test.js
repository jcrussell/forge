import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-2ngl: swapPairs exchanged the pair's modes BEFORE the get_frame_rect
 * null-guard. On the null-rect early-return (Bug #354 added the guard precisely
 * because a live window can transiently return null post sleep/resume) the two
 * nodes kept their EXCHANGED modes while their tree positions were untouched — a
 * FLOAT/TILE pair stranded the wrong window in/out of tiling, since renderTree
 * treats node.mode as authoritative and nothing re-corrected it.
 *
 * Fix: change modes only AFTER both frame rects validate. Floats are no longer
 * swappable (forge-no5x), so the mode change left is the GRAB_TILE -> TILE
 * normalization (forge-j9fo); an aborted swap must not apply it either.
 */
describe("Bug forge-2ngl: swapPairs leaves modes untouched on a null-rect abort", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
  });

  afterEach(() => ctx.cleanup());

  it("does not swap TILE<->GRAB_TILE modes when a frame rect is null", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const tileWin = createMockWindow({ id: 3001 });
    const grabWin = createMockWindow({ id: 3002 });
    const tileNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, tileWin);
    const grabNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, grabWin);

    tileNode.mode = WINDOW_MODES.TILE;
    // A floating partner is rejected up front (forge-no5x); a drag-swap's
    // GRAB_TILE is the mode that still reaches the exchange.
    grabNode.mode = WINDOW_MODES.GRAB_TILE;

    // Bug #354's transient failure: one participant returns a null frame rect.
    tileWin.get_frame_rect = () => null;

    ctx.tree.swapPairs(grabNode, tileNode, false);

    // The swap aborted, so both modes must be exactly as they were. Pre-fix the
    // modes were already exchanged (the TILE node became GRAB_TILE and vice versa).
    expect(tileNode.mode).toBe(WINDOW_MODES.TILE);
    expect(grabNode.mode).toBe(WINDOW_MODES.GRAB_TILE);
  });
});
