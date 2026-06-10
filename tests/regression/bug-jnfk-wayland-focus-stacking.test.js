import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * forge-jnfk: the Bug #416 Wayland stacking block in Tree.focus() referenced
 * GLib without importing it. On Wayland, focusing a not-above window ran
 * make_above(), then GLib.timeout_add threw a ReferenceError (swallowed by the
 * surrounding catch), so the 50ms unmake_above() restore never got scheduled —
 * the window was left permanently always-on-top, and notify::above made Forge
 * treat it as a user "Always on Top" pin (float eject via isFloatingExempt).
 *
 * Fix: import GLib in tree.js; wrap the make_above/unmake_above pair in
 * _withSuppressedAboveHandler so Forge's own transient pin is never mistaken
 * for a user pin; clear a pending _waylandStackingTimeoutId on disable().
 */
describe("forge-jnfk: Wayland focus stacking restores above-state", () => {
  let ctx;
  let nodeA, nodeB;
  let winA, winB;

  beforeEach(() => {
    Meta.__setWayland(true);
    ctx = createWindowManagerFixture();

    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    winA = createMockWindow({ wm_class: "AppA" });
    winB = createMockWindow({ wm_class: "AppB" });
    nodeA = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, winA);
    nodeB = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, winB);
    nodeA.mode = WINDOW_MODES.TILE;
    nodeB.mode = WINDOW_MODES.TILE;
  });

  afterEach(() => {
    Meta.__setWayland(false);
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("schedules and runs the unmake_above restore (was: ReferenceError left the window pinned)", () => {
    const timeouts = [];
    vi.spyOn(GLib, "timeout_add").mockImplementation((priority, interval, callback) => {
      timeouts.push(callback);
      return 42;
    });

    const next = ctx.tree.focus(nodeA, MotionDirection.RIGHT);

    expect(next).toBe(nodeB);
    // The transient pin is in place until the restore timer fires.
    expect(winB.is_above()).toBe(true);
    expect(timeouts).toHaveLength(1);

    timeouts[0]();
    expect(winB.is_above()).toBe(false);
  });

  it("suppresses the user-above handler around its own make_above/unmake_above", () => {
    const timeouts = [];
    vi.spyOn(GLib, "timeout_add").mockImplementation((priority, interval, callback) => {
      timeouts.push(callback);
      return 42;
    });
    const suppressedDuring = [];
    for (const win of [winB]) {
      const realMakeAbove = win.make_above.bind(win);
      const realUnmakeAbove = win.unmake_above.bind(win);
      vi.spyOn(win, "make_above").mockImplementation(() => {
        suppressedDuring.push(ctx.windowManager._suppressAboveHandler);
        realMakeAbove();
      });
      vi.spyOn(win, "unmake_above").mockImplementation(() => {
        suppressedDuring.push(ctx.windowManager._suppressAboveHandler);
        realUnmakeAbove();
      });
    }

    ctx.tree.focus(nodeA, MotionDirection.RIGHT);
    timeouts.forEach((cb) => cb());

    // make_above then unmake_above, both with the suppress flag held.
    expect(suppressedDuring).toEqual([true, true]);
    expect(ctx.windowManager._suppressAboveHandler).toBeFalsy();
  });

  it("does not unpin a window the user already had above", () => {
    const timeoutSpy = vi.spyOn(GLib, "timeout_add");
    winB.make_above();

    ctx.tree.focus(nodeA, MotionDirection.RIGHT);

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(winB.is_above()).toBe(true);
  });

  it("clears a pending restore timer on disable()", () => {
    vi.spyOn(GLib, "timeout_add").mockReturnValue(42);
    const removeSpy = vi.spyOn(GLib.Source, "remove");

    ctx.tree.focus(nodeA, MotionDirection.RIGHT);
    expect(ctx.tree._waylandStackingTimeoutId).toBe(42);

    ctx.windowManager.disable();
    expect(removeSpy).toHaveBeenCalledWith(42);
  });
});
