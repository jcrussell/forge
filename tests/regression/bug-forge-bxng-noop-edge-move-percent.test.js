import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-bxng (audit-2026-07 / C10): tree.move()'s `next === -1` edge branch
 * reparents into the node's own monitor and always runs _finishMove ->
 * resetSiblingPercent. When the node is ALREADY the monitor's direct last/first
 * child, that reparent is a positional no-op, but the percent reset still fires and
 * discards the user's custom split proportions (e.g. 30/70 snaps back to 50/50).
 *
 * Fix: skip _finishMove for the no-op edge reparent (a genuine reparent out of a
 * nested container still runs the epilogue — forge-qxqb).
 */
describe("Bug forge-bxng: no-op edge move preserves custom sibling percents", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
  });

  afterEach(() => ctx.cleanup());

  it("keeps A=0.3/B=0.7 when the rightmost window edge-moves right (no-op)", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = ctx.tree.createNode(
      monitor.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ id: 1 })
    );
    const b = ctx.tree.createNode(
      monitor.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ id: 2 })
    );
    a.mode = WINDOW_MODES.TILE;
    b.mode = WINDOW_MODES.TILE;
    a.percent = 0.3;
    b.percent = 0.7;

    // Rightmost child moving right: edge branch (next() === -1).
    vi.spyOn(ctx.tree, "next").mockReturnValue(-1);

    const moved = ctx.tree.move(b, MotionDirection.RIGHT);

    expect(moved).toBe(true); // still reports handled (matches forge-s7ri)
    expect(a.percent).toBe(0.3);
    expect(b.percent).toBe(0.7);
  });
});
