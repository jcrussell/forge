import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  finalizeWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-0qx7 (audit-2026-07 / C2): trackCurrentMonWs() reads
 * w.nodeValue.minimized (and isTile()) for every WINDOW node with no
 * Utils.isWindowAlive probe. It runs directly from raw signal handlers
 * (grab-op-begin, window-entered-monitor, active-workspace-changed) BEFORE
 * pruneDeadWindows, so a finalized wrapper's .minimized throws "already
 * deallocated" and aborts the tracking mid-filter (drag untracked, sortedWindows
 * stale).
 *
 * Fix: skip dead windows via Utils.isWindowAlive in the filter.
 */
describe("Bug forge-0qx7: trackCurrentMonWs skips finalized windows", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("does not throw when a workspace window wrapper is finalized", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    const live = createMockWindow({ id: 9101, workspace: ctx.workspaces[0] });
    const liveNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, live);
    liveNode.mode = WINDOW_MODES.TILE;

    const dead = createMockWindow({ id: 9102, workspace: ctx.workspaces[0] });
    const deadNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dead);
    deadNode.mode = WINDOW_MODES.TILE;
    finalizeWindow(dead);

    // A live focus window drives the tracking (not the dead one).
    ctx.display.get_focus_window.mockReturnValue(live);

    expect(() => ctx.windowManager.trackCurrentMonWs()).not.toThrow();
    expect(Array.isArray(ctx.windowManager.sortedWindows)).toBe(true);
  });
});
