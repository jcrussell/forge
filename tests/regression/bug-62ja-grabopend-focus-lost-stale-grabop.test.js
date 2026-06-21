import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createMockWindow,
} from "../mocks/helpers/index.js";
import { GrabOp, MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-62ja: when focus is lost mid-drag (dragged window closed / crossed
 * monitors), _handleGrabOpEnd returned early after only releasing the dragged
 * node's preview hint, skipping `this.nodeWinAtPointer = null` and the forge-leqs
 * `this.grabOp = null`. The stale grabOp survived until the next grab-op-begin,
 * so the WINDOW_BASE guard in updateMetaWorkspaceMonitor read a finished drag's
 * op and wrongly skipped updateTabbedFocus on a subsequent re-home.
 *
 * Fix: clear grabOp + nodeWinAtPointer on the focus-lost exit path too.
 */
describe("Bug forge-62ja: focus-lost grab-op-end clears stale per-grab state", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { GrabOp, MotionDirection };
  });

  afterEach(() => ctx.cleanup());

  it("nulls grabOp and nodeWinAtPointer when focus is lost mid-drag", () => {
    const wm = ctx.windowManager;
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const dummy = createMockWindow({ id: 4242 });

    // Simulate a finished drag whose focus was lost (window closed / monitor cross).
    global.display.get_focus_window.mockReturnValue(null);
    wm.grabOp = GrabOp.WINDOW_BASE;
    wm.nodeWinAtPointer = ctx.tree.createNode(monitor.nodeValue, "WINDOW", dummy);
    wm._draggedNodeWindow = null;

    expect(() => wm._handleGrabOpEnd(null, null, GrabOp.WINDOW_BASE)).not.toThrow();
    expect(wm.grabOp).toBe(null);
    expect(wm.nodeWinAtPointer).toBe(null);
  });
});
