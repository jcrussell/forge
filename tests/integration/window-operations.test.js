import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createHorizontalLayout,
  createContainerNode,
  createWindowNode,
} from "../mocks/helpers/index.js";

/**
 * Window layout integration tests.
 *
 * These exercise Forge's REAL tiling pipeline end-to-end: a tree is built with
 * the fixtures (createWindowManagerFixture), window nodes are added under a
 * monitor with a known 1920x1080 work area, and the actual layout algorithm
 * (Tree.processNode -> getTiledChildren/computeSizes -> processSplit, then
 * renderRect via processGap) is driven. Assertions are made on the COMPUTED
 * rects produced by lib/extension/tree.js, not on hand-rolled arithmetic.
 *
 * Default settings give 0 gap and 0 margins, so the monitor work area
 * (1920x1080) is divided exactly and renderRect == rect.
 */
describe("Window Layout Integration", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("tiles two windows side by side via the real HSPLIT pipeline", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    // Two tiled windows directly under the monitor in a horizontal split.
    const [w1, w2] = createHorizontalLayout(ctx.tree, monitor, 2);

    // Drive the real layout computation.
    ctx.tree.processNode(monitor);

    // The monitor resolved its 1920x1080 work area and split it in half.
    expect(monitor.rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });

    // Left window: x:0, w:960, full height.
    expect(w1.nodeWindow.rect).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
    expect(w1.nodeWindow.renderRect).toEqual({ x: 0, y: 0, width: 960, height: 1080 });

    // Right window: x:960, w:960, full height.
    expect(w2.nodeWindow.rect).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
    expect(w2.nodeWindow.renderRect).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
  });

  it("tiles four windows into quadrants via nested HSPLIT/VSPLIT containers", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    // monitor (HSPLIT) -> [ left (VSPLIT)[w0, w1], right (VSPLIT)[w2, w3] ]
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const left = createContainerNode(monitor, LAYOUT_TYPES.VSPLIT);
    const right = createContainerNode(monitor, LAYOUT_TYPES.VSPLIT);

    const tl = createWindowNode(ctx.tree, left, { mode: "TILE" });
    const bl = createWindowNode(ctx.tree, left, { mode: "TILE" });
    const tr = createWindowNode(ctx.tree, right, { mode: "TILE" });
    const br = createWindowNode(ctx.tree, right, { mode: "TILE" });

    // Drive the real layout computation (recurses monitor -> CON -> windows).
    ctx.tree.processNode(monitor);

    // Containers split the monitor into left/right halves.
    expect(left.rect).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
    expect(right.rect).toEqual({ x: 960, y: 0, width: 960, height: 1080 });

    // Each half is split vertically into two quadrants.
    expect(tl.nodeWindow.renderRect).toEqual({ x: 0, y: 0, width: 960, height: 540 });
    expect(bl.nodeWindow.renderRect).toEqual({ x: 0, y: 540, width: 960, height: 540 });
    expect(tr.nodeWindow.renderRect).toEqual({ x: 960, y: 0, width: 960, height: 540 });
    expect(br.nodeWindow.renderRect).toEqual({ x: 960, y: 540, width: 960, height: 540 });
  });
});
