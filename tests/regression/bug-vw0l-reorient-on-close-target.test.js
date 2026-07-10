import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * Bug forge-vw0l: removeNode's auto-reorient-on-close call had two defects.
 * (1) In the collapse branch it detaches parentNode (the closing node's single-
 * child CON) but then reoriented THAT now-detached CON — a dead write — while
 * existParent (the container that actually lost a child) was never reoriented, so
 * the feature was inert for the single-window-sub-CON shape auto-split produces.
 * (2) It reoriented unconditionally, including on FLOAT-window removal, flipping a
 * live container's manual orientation although no tiled slot was freed.
 *
 * Fix: reorient the container that lost a child, and skip floating removals.
 * Gated on auto-reorient-on-close.
 */
describe("Bug forge-vw0l: reorient-on-close targets the surviving container", () => {
  let ctx;
  const landscape = { x: 0, y: 0, width: 1920, height: 1080 };

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "auto-reorient-on-close": true } });
    vi.spyOn(ctx.windowManager, "renderTree").mockImplementation(() => {});
  });

  afterEach(() => ctx.cleanup());

  it("reorients the outer container when a single-child sub-CON collapses", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const outer = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    outer.layout = LAYOUT_TYPES.VSPLIT;
    outer.rect = landscape;
    const inner = ctx.tree.createNode(outer.nodeValue, NODE_TYPES.CON, new Bin());
    inner.layout = LAYOUT_TYPES.VSPLIT;
    inner.rect = landscape;
    const w1 = ctx.tree.createNode(inner.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 1 }));
    ctx.tree.createNode(outer.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 2 })).mode =
      WINDOW_MODES.TILE;
    w1.mode = WINDOW_MODES.TILE;

    ctx.tree.removeNode(w1);

    // The landscape outer container is re-derived to HSPLIT (it lost a child);
    // pre-fix it stayed VSPLIT because the detached inner CON was reoriented.
    expect(outer.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });

  it("does not reorient the container when a FLOAT window is removed", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    con.layout = LAYOUT_TYPES.VSPLIT;
    con.rect = landscape;
    ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 1 })).mode =
      WINDOW_MODES.TILE;
    ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 2 })).mode =
      WINDOW_MODES.TILE;
    const floatNode = ctx.tree.createNode(
      con.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ id: 3 })
    );
    floatNode.mode = WINDOW_MODES.FLOAT;

    ctx.tree.removeNode(floatNode);

    // No tiled slot was freed, so the manual VSPLIT stands; pre-fix it flipped.
    expect(con.layout).toBe(LAYOUT_TYPES.VSPLIT);
  });
});
