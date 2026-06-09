import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES, POSITION, ORIENTATION_TYPES } from "../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createMockWindow,
} from "../mocks/helpers/index.js";

/**
 * Bug #379 (forge-2zj): cross-monitor focus up/down (Ctrl+K / Ctrl+J) is
 * unreliable on vertically-stacked monitors.
 *
 * tree.nextMonitor() relies on Mutter's get_monitor_neighbor_index(), which can
 * return -1 for a monitor that is geometrically adjacent above/below. When that
 * happens focus never crosses to the stacked neighbor. The fix adds a
 * geometry-based fallback (_neighborMonitorByGeometry) before treating -1 as a
 * true boundary.
 *
 * The mock's get_monitor_neighbor_index defaults to -1, so these tests exercise
 * the fallback path directly against real monitor geometries.
 */
const VERTICAL_STACK = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 0, y: 1080, width: 1920, height: 1080 },
];

const HORIZONTAL_SIDE_BY_SIDE = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 1920, y: 0, width: 1920, height: 1080 },
];

function makeFixture(monitorGeometries) {
  return createWindowManagerFixture({
    globals: { display: { monitorCount: 2, monitorGeometries } },
  });
}

function windowNodeOnMonitor(ctx, monitorIndex) {
  const { monitor } = getWorkspaceAndMonitor(ctx, 0, monitorIndex);
  const metaWindow = createMockWindow({ monitor: monitorIndex, workspace: ctx.workspaces[0] });
  return ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
}

describe("Bug #379: vertically-stacked monitor focus", () => {
  let ctx;

  afterEach(() => {
    ctx?.cleanup();
  });

  it("resolves the monitor below when moving DOWN from the top monitor", () => {
    ctx = makeFixture(VERTICAL_STACK);
    const node = windowNodeOnMonitor(ctx, 0);

    const target = ctx.tree.nextMonitor(node, POSITION.AFTER, ORIENTATION_TYPES.VERTICAL);

    const { monitor: mon1 } = getWorkspaceAndMonitor(ctx, 0, 1);
    expect(target).toBe(mon1);
  });

  it("resolves the monitor above when moving UP from the bottom monitor", () => {
    ctx = makeFixture(VERTICAL_STACK);
    const node = windowNodeOnMonitor(ctx, 1);

    const target = ctx.tree.nextMonitor(node, POSITION.BEFORE, ORIENTATION_TYPES.VERTICAL);

    const { monitor: mon0 } = getWorkspaceAndMonitor(ctx, 0, 0);
    expect(target).toBe(mon0);
  });

  it("returns -1 (no neighbor) for UP/DOWN on side-by-side monitors", () => {
    ctx = makeFixture(HORIZONTAL_SIDE_BY_SIDE);
    const node = windowNodeOnMonitor(ctx, 0);

    expect(ctx.tree.nextMonitor(node, POSITION.AFTER, ORIENTATION_TYPES.VERTICAL)).toBe(-1);
    expect(ctx.tree.nextMonitor(node, POSITION.BEFORE, ORIENTATION_TYPES.VERTICAL)).toBe(-1);
  });
});
