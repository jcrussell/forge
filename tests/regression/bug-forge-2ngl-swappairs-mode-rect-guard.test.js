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
 * Fix: exchange modes only AFTER both frame rects validate.
 */
describe("Bug forge-2ngl: swapPairs leaves modes untouched on a null-rect abort", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
  });

  afterEach(() => ctx.cleanup());

  it("does not swap TILE<->FLOAT modes when a frame rect is null", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const tileWin = createMockWindow({ id: 3001 });
    const floatWin = createMockWindow({ id: 3002 });
    const tileNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, tileWin);
    const floatNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, floatWin);

    tileNode.mode = WINDOW_MODES.TILE;
    floatNode.mode = WINDOW_MODES.FLOAT;

    // Bug #354's transient failure: one participant returns a null frame rect.
    tileWin.get_frame_rect = () => null;

    ctx.tree.swapPairs(tileNode, floatNode, false);

    // The swap aborted, so both modes must be exactly as they were. Pre-fix the
    // modes were already exchanged (TILE node became FLOAT and vice versa).
    expect(tileNode.mode).toBe(WINDOW_MODES.TILE);
    expect(floatNode.mode).toBe(WINDOW_MODES.FLOAT);
  });
});
