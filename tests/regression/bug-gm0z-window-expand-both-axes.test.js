import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-gm0z: WindowExpand/WindowShrink only ever resized horizontally.
 *
 * The old path fired four overlapping wm.resize() grabs (N, S, W, E). Each wrote
 * the single shared this.grabOp, and _handleResizing is async/signal-driven, so
 * by the time signals fired only RESIZING_E survived — the window never grew
 * vertically, and a rightmost-column window with no right sibling did not grow
 * at all.
 *
 * NOTE: the original single-axis symptom is only fully observable in e2e (the
 * old path went through move_resize_frame + async size-changed signals a unit
 * test cannot drive). These tests verify the NEW wm.expand() method's correct
 * two-axis behavior: it grows the focused window in BOTH its split pairs.
 */
describe("Bug forge-gm0z: WindowExpand grows on both axes", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  // Build a 2x2 grid: monitor HSPLIT of two VSPLIT columns, each with two rows.
  // Returns the four window nodes [TL, BL, TR, BR] and the two column cons.
  function build2x2() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    const colL = createContainerNode(monitor, LAYOUT_TYPES.VSPLIT, {
      x: 0,
      y: 0,
      width: 960,
      height: 1080,
    });
    colL.percent = 0.5;
    const colR = createContainerNode(monitor, LAYOUT_TYPES.VSPLIT, {
      x: 960,
      y: 0,
      width: 960,
      height: 1080,
    });
    colR.percent = 0.5;

    const mkWin = (parent, rect, id) => {
      const meta = createMockWindow({ id, workspace: ctx.workspaces[0] });
      const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, meta);
      node.mode = WINDOW_MODES.TILE;
      node.percent = 0.5;
      node.rect = rect;
      return node;
    };

    const tl = mkWin(colL, { x: 0, y: 0, width: 960, height: 540 }, "TL");
    const bl = mkWin(colL, { x: 0, y: 540, width: 960, height: 540 }, "BL");
    const tr = mkWin(colR, { x: 960, y: 0, width: 960, height: 540 }, "TR");
    const br = mkWin(colR, { x: 960, y: 540, width: 960, height: 540 }, "BR");

    return { tl, bl, tr, br, colL, colR };
  }

  it("expands the focused window in BOTH its vertical and horizontal split pairs", () => {
    const { tl, bl, colL, colR } = build2x2();
    // Skip the actual render (rect recomputation) — we only assert percents.
    vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    ctx.display.get_focus_window.mockReturnValue(tl.nodeValue);

    wm().expand(54); // 54px = 10% of the 540px row, 5.625% of the 960px column

    // Vertical axis: TL grew within its column, debiting its row sibling BL.
    expect(tl.percent).toBeGreaterThan(0.5);
    expect(bl.percent).toBeLessThan(0.5);
    expect(tl.percent + bl.percent).toBeCloseTo(1.0, 5);

    // Horizontal axis: the enclosing column (colL) grew against the other column.
    expect(colL.percent).toBeGreaterThan(0.5);
    expect(colR.percent).toBeLessThan(0.5);
    expect(colL.percent + colR.percent).toBeCloseTo(1.0, 5);
  });

  it("expands vertically even for a rightmost-column window with no right sibling", () => {
    const { tr, br, colL, colR } = build2x2();
    vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    ctx.display.get_focus_window.mockReturnValue(tr.nodeValue);

    const colRBefore = colR.percent;
    const colLBefore = colL.percent;

    wm().expand(54);

    // The original bug: a rightmost window with no right neighbor did not grow.
    // Now it grows vertically within its own column...
    expect(tr.percent).toBeGreaterThan(0.5);
    expect(br.percent).toBeLessThan(0.5);
    expect(tr.percent + br.percent).toBeCloseTo(1.0, 5);

    // ...and the column expands horizontally against the OTHER column (its
    // split pair is the previous sibling since colR is the last child).
    expect(colR.percent).toBeGreaterThan(colRBefore);
    expect(colL.percent).toBeLessThan(colLBefore);
    expect(colL.percent + colR.percent).toBeCloseTo(1.0, 5);
  });

  it("shrink is expand with a negative amount", () => {
    const { tl, bl } = build2x2();
    vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    ctx.display.get_focus_window.mockReturnValue(tl.nodeValue);

    wm().shrink(54);

    expect(tl.percent).toBeLessThan(0.5);
    expect(bl.percent).toBeGreaterThan(0.5);
    expect(tl.percent + bl.percent).toBeCloseTo(1.0, 5);
  });
});
