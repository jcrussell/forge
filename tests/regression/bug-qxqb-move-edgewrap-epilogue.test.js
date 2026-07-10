import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * Bug forge-qxqb: tree.move's `next === -1` edge-wrap branch reparents the node to
 * its monitor and returns true EARLY, skipping the shared epilogue every other
 * structural-move path runs (resetSiblingPercent on both the old parent and the
 * target, plus resetLayoutSingleChild on the old parent). So the old container's
 * survivors keep percents summing < 1 (Bug #330 fold then dumps the slack on one
 * child) and a stacked/tabbed old parent reduced to one child keeps its layout.
 *
 * Fix: run the epilogue (via _finishMove) before the edge-wrap early return.
 */
describe("Bug forge-qxqb: edge-wrap move runs the sibling-reset epilogue", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
  });

  afterEach(() => ctx.cleanup());

  it("resets the old container's percents when a resized child edge-wraps out", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    con.layout = LAYOUT_TYPES.VSPLIT;
    const w1 = ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 1 }));
    const w2 = ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 2 }));
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 3 })).mode =
      WINDOW_MODES.TILE;
    w1.mode = WINDOW_MODES.TILE;
    w2.mode = WINDOW_MODES.TILE;
    w1.percent = 0.7;
    w2.percent = 0.3;

    // Force the edge-wrap branch (no adjacent node/monitor in the move direction).
    vi.spyOn(ctx.tree, "next").mockReturnValue(-1);

    ctx.tree.move(w1, MotionDirection.LEFT);

    // The old VSPLIT container's survivor is reset (would keep .3 without the fix),
    // and the moved node no longer carries its old in-container percent.
    expect(w2.percent).toBe(0);
    expect(w1.percent).toBe(0);
  });

  it("resets a single-child TABBED old parent's layout on edge-wrap out", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    con.layout = LAYOUT_TYPES.TABBED;
    const w1 = ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 1 }));
    const w2 = ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 2 }));
    w1.mode = WINDOW_MODES.TILE;
    w2.mode = WINDOW_MODES.TILE;

    vi.spyOn(ctx.tree, "next").mockReturnValue(-1);

    ctx.tree.move(w1, MotionDirection.LEFT);

    // con now holds a single child; its TABBED layout is reset to a real split.
    expect(con.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });
});
