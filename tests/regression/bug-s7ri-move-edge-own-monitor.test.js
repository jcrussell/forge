import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * forge-s7ri: Tree.move()'s edge-wrap branch and MONITOR fallback both used
 * extWm.currentMonWsNode, which resolves via display.get_current_monitor() — the
 * monitor under the POINTER, not the focused node's monitor. With the pointer on
 * a different monitor than the focused window, a keyboard move at a display edge
 * appended the window to the pointer's monitor, teleporting it across monitors.
 *
 * Fix: resolve the node's OWN monitor from the tree (findAncestorMonitor) and use
 * it for the edge-wrap, the firstChild/lastChild edge test, and the fallback.
 */
describe("forge-s7ri: edge move keeps the window on its own monitor", () => {
  let ctx;
  let monA; // mo0ws0 (pointer rests here)
  let monB; // mo1ws0 (focused window lives here)

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      globals: { display: { monitorCount: 2 } },
    });
    monA = getWorkspaceAndMonitor(ctx, 0, 0).monitor;
    monB = getWorkspaceAndMonitor(ctx, 0, 1).monitor;
    // Pointer-derived node points at monitor A — the source of the bug.
    ctx.extWm.currentMonWsNode = monA;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function windowOnMonB() {
    const win = createMockWindow({ id: "w", monitor: 1, workspace: ctx.workspaces[0] });
    const node = ctx.tree.createNode(monB.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  it("wraps within its own monitor at a display edge (no neighbor), not the pointer's monitor", () => {
    const node = windowOnMonB();
    // Moving RIGHT off the rightmost monitor: next() === -1 (edge branch).
    const moved = ctx.tree.move(node, MotionDirection.RIGHT);

    expect(moved).toBe(true);
    expect(monB.contains(node)).toBe(true); // stayed on its own monitor
    expect(monA.contains(node)).toBe(false); // not teleported to the pointer monitor
  });

  it("runs the proper cross-monitor move toward a real neighbor even when the pointer is elsewhere", () => {
    const node = windowOnMonB();
    // Moving LEFT toward monitor A (a real neighbor): the legitimate cross-monitor
    // path must run (rectForMonitor + extWm.move). The old firstChild/lastChild
    // guard keyed on the pointer monitor, so it fell through to the bare append.
    const moved = ctx.tree.move(node, MotionDirection.LEFT);

    expect(moved).toBe(true);
    expect(monA.contains(node)).toBe(true);
    expect(ctx.extWm.rectForMonitor).toHaveBeenCalled();
  });
});
