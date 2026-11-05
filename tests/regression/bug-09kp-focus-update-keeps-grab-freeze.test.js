import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Meta from "gi://Meta";
import GLib from "gi://GLib";
import { LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-09kp: clicking an unfocused tiled window to drag it focuses it first,
 * and the "focus" handler queues a "focus-update" event (~220 ms). grab-op-begin
 * freezes rendering in between, and the focus-update callback then unfroze it
 * mid-drag: any later render laid out the tree without the dragged window, and in
 * a stack updateStackedFocus re-stacked it and queued a "render-focus-stack" reflow.
 *
 * Fix: focus-update keeps the freeze while a grab is live. The idle mock is
 * deferred (as in bug-forge-opsl) so the focus render drains before the grab.
 */
describe("Bug forge-09kp: a queued focus-update keeps the drag freeze", () => {
  let ctx, wm, queued, pending;
  const realIdleAdd = GLib.idle_add;

  const flush = () => {
    while (pending.length) {
      const cb = pending.shift();
      if (cb() === true) pending.push(cb);
    }
  };

  beforeEach(() => {
    pending = [];
    GLib.idle_add = (priority, cb) => {
      pending.push(cb);
      return pending.length;
    };
    ctx = createWindowManagerFixture();
    wm = ctx.windowManager;
    queued = [];
    vi.spyOn(wm, "queueEvent").mockImplementation((e) => queued.push(e));
  });

  afterEach(() => {
    GLib.idle_add = realIdleAdd;
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  /** Track three tiled windows, click-focus `a`, and return its focus-update event. */
  function focusFirst(layout) {
    const ws = ctx.workspaces[0];
    const [a, b, c] = ["A", "B", "C"].map((wm_class) =>
      createMockWindow({ wm_class, workspace: ws })
    );
    [a, b, c].forEach((w) => wm.trackWindow(null, w));
    flush();
    if (layout) getWorkspaceAndMonitor(ctx, 0, 0).monitor.layout = layout;
    queued.length = 0;
    ctx.display.get_focus_window.mockReturnValue(a);
    a.emit("focus", a);
    flush();
    const focusUpdate = queued.find((e) => e.name === "focus-update");
    expect(focusUpdate).toBeDefined();
    queued.length = 0;
    return { a, focusUpdate };
  }

  for (const layout of [null, LAYOUT_TYPES.STACKED]) {
    it(`stays frozen and queues no reflow during the drag (${layout ?? "split"})`, () => {
      const { a, focusUpdate } = focusFirst(layout);
      wm._handleGrabOpBegin(global.display, a, Meta.GrabOp.MOVING);
      expect(wm.tree.findNode(a).mode).toBe(WINDOW_MODES.GRAB_TILE);
      const moveSpy = vi.spyOn(wm, "move");

      focusUpdate.callback();
      expect(wm._freezeRender).toBe(true);
      expect(queued.map((e) => e.name)).not.toContain("render-focus-stack");

      wm.renderTree("notify-above");
      flush();
      expect(moveSpy).not.toHaveBeenCalled();
    });
  }

  it("still unfreezes when no grab is live (stranded-freeze safety net)", () => {
    const { focusUpdate } = focusFirst(null);
    wm.freezeRender();

    focusUpdate.callback();

    expect(wm._freezeRender).toBe(false);
  });
});
