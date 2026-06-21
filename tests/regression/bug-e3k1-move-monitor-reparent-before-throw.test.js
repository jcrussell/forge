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
 * forge-e3k1: Tree.move()'s cross-monitor branch reparented the node onto the
 * target monitor (insertBefore/appendChild) BEFORE running extWm.move(), whose
 * get_work_area_for_monitor/move_resize_frame can throw on a finalized
 * MetaWindow (window closed mid-move after sleep/resume). The trailing
 * resetSiblingPercent calls sit outside any try/finally, so a throw left the
 * node reparented onto the neighbor monitor with stale percents on both
 * monitors until the next reload.
 *
 * Fix: resolve the work-area and perform the actual window move BEFORE mutating
 * the tree, so a throw leaves the node on its original monitor untouched.
 */
describe("forge-e3k1: cross-monitor move does not reparent before the window move can throw", () => {
  let ctx;
  let monA; // mo0ws0
  let monB; // mo1ws0 (focused window lives here)

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      globals: { display: { monitorCount: 2 } },
    });
    monA = getWorkspaceAndMonitor(ctx, 0, 0).monitor;
    monB = getWorkspaceAndMonitor(ctx, 0, 1).monitor;
    ctx.extWm.currentMonWsNode = monA;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function tiledWindowOnMonB(id) {
    const win = createMockWindow({ id, monitor: 1, workspace: ctx.workspaces[0] });
    const node = ctx.tree.createNode(monB.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  it("leaves the node on its origin monitor when extWm.move throws (finalized window)", () => {
    // Two tiled windows on monitor B so the tree is non-trivial and percents matter.
    const node = tiledWindowOnMonB("w-moving");
    tiledWindowOnMonB("w-sibling");

    // A finalized MetaWindow makes the geometry move throw mid-operation.
    ctx.extWm.move.mockImplementation(() => {
      throw new Error("finalized window");
    });

    // Moving LEFT targets the real neighbor monitor A (cross-monitor branch).
    expect(() => ctx.tree.move(node, MotionDirection.LEFT)).toThrow();

    // The throw must NOT have committed the reparent.
    expect(monB.contains(node)).toBe(true);
    expect(monA.contains(node)).toBe(false);
  });
});
