import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { GRAB_TYPES } from "../../lib/extension/window.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../mocks/helpers/index.js";
import { Rectangle, GrabOp, MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-9fwj (NOT A DEFECT — regression guard).
 *
 * The report claimed: keyboard resize() arms a single 120ms debounce whose fire
 * calls _handleGrabOpEnd, which operates on this.focusMetaWindow. If focus is
 * stolen within 120ms by a window that issues NO grab-op-begin (new-window map,
 * modal/notification) and the user never resizes the original again, the timer
 * was said to _grabCleanup the NEW node and strand the ORIGINAL with
 * grabMode=RESIZING / initRect set forever.
 *
 * Investigation (forge-9fwj close) found this cannot happen: _handleGrabOpBegin
 * records the arming node in this._draggedNodeWindow (Bug #433), and
 * _handleGrabOpEnd cleans it via
 *   if (this._draggedNodeWindow && this._draggedNodeWindow !== focusNodeWindow)
 *     this._grabCleanup(this._draggedNodeWindow)
 * so the arming node is released on every timer fire regardless of focus drift.
 * The bead's proposed "clean the captured node instead" would REGRESS by dropping
 * grabOp=null + renderTree. So: no code change; this test locks the behavior in.
 */
describe("Bug forge-9fwj: keyboard-resize debounce cleans the arming node on focus drift", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "focus-on-hover-enabled": false },
    });
    ctx.display.sort_windows_by_stacking = vi.fn((windows) => windows);
    global.Meta = { GrabOp, MotionDirection };
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("releases grabMode/initRect on the ORIGINAL window when focus drifts without a grab-op-begin", () => {
    const wm = ctx.windowManager;
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const workspace = ctx.workspaces[0];

    // Two tiled windows A and B in the tree.
    const { nodeWindow: nodeA, metaWindow: winA } = createWindowNode(ctx.tree, monitor, {
      windowOverrides: {
        id: "win-A",
        workspace,
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
      },
    });
    const { nodeWindow: nodeB, metaWindow: winB } = createWindowNode(ctx.tree, monitor, {
      windowOverrides: {
        id: "win-B",
        workspace,
        rect: new Rectangle({ x: 800, y: 0, width: 800, height: 600 }),
      },
    });

    // Capture the 120ms debounced grab-end callback instead of letting it fire on a timer.
    let endCb = null;
    vi.spyOn(GLib, "timeout_add").mockImplementation((_priority, _delay, cb) => {
      endCb = cb;
      return 7;
    });

    // Focus A and issue a keyboard resize — arms the debounce and opens a grab on A.
    ctx.display.get_focus_window.mockReturnValue(winA);
    wm.resize(GrabOp.KEYBOARD_RESIZING_E, 50);

    // Precondition: the resize actually armed A's grab state (non-vacuous).
    expect(nodeA.grabMode).toBe(GRAB_TYPES.RESIZING);
    expect(nodeA.initRect).not.toBe(null);
    expect(wm._draggedNodeWindow).toBe(nodeA);
    expect(wm.grabOp).toBe(GrabOp.KEYBOARD_RESIZING_E);
    expect(typeof endCb).toBe("function");

    // Focus is stolen by B, which issues NO grab-op-begin, and the user never
    // resizes A again. Then the debounce fires.
    ctx.display.get_focus_window.mockReturnValue(winB);
    expect(() => endCb()).not.toThrow();

    // The arming window A must NOT be left with stale grab state...
    expect(nodeA.grabMode).toBe(null);
    expect(nodeA.initRect).toBe(null);
    // ...and the live grab op is cleared (forge-leqs), so later size-changed
    // handling takes the normal render path, not the no-op resize branch.
    expect(wm.grabOp).toBe(null);
    // B, which never armed a grab, is untouched.
    expect(nodeB.grabMode).toBe(null);

    void winB;
  });
});
