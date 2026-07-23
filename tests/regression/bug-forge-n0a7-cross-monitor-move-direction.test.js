import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-n0a7 (audit-2026-07 / C11b): tree.move()'s MONITOR-case gate crosses to
 * the adjacent monitor only when the node is its own monitor's firstChild/lastChild,
 * ignoring the move direction. In a monitor split perpendicular to the move (e.g. a
 * VSPLIT monitor moving right), next() escalates every child to the MONITOR case, but
 * a MIDDLE child fails the first/last gate and falls into the else -> gets appended to
 * the bottom of its OWN monitor (moves down on a "right" command). It only crosses on
 * a second press.
 *
 * Fix: reaching the MONITOR case already means there is no in-direction sibling within
 * the monitor, so the node is at the monitor edge in that direction — cross to the
 * neighbor regardless of first/last position.
 */
describe("Bug forge-n0a7: middle child crosses monitors in the move direction", () => {
  let ctx;
  let leftMon;
  let rightMon;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true, globals: { display: { monitorCount: 2 } } });
    leftMon = getWorkspaceAndMonitor(ctx, 0, 0).monitor;
    rightMon = getWorkspaceAndMonitor(ctx, 0, 1).monitor;
    ctx.extWm.currentMonWsNode = leftMon;
  });

  afterEach(() => ctx.cleanup());

  it("move-right on the middle window of a VSPLIT monitor crosses to the right monitor", () => {
    leftMon.layout = LAYOUT_TYPES.VSPLIT;
    const mk = (id) =>
      ctx.tree.createNode(
        leftMon.nodeValue,
        NODE_TYPES.WINDOW,
        createMockWindow({ id, monitor: 0, workspace: ctx.workspaces[0] })
      );
    const w1 = mk(1);
    const w2 = mk(2);
    const w3 = mk(3);
    [w1, w2, w3].forEach((w) => (w.mode = WINDOW_MODES.TILE));

    const moved = ctx.tree.move(w2, MotionDirection.RIGHT);

    expect(moved).toBe(true);
    expect(rightMon.contains(w2)).toBe(true);
    expect(leftMon.contains(w2)).toBe(false);
  });
});
