import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug forge-2hbi: queueEvent drains one event per 220 ms and never coalesced, so
 * a burst of focus changes (held Super+J/K autorepeats ~30/s) replayed every
 * "focus-update" one tick at a time, and a new window's "window-first-frame"
 * waited behind the whole backlog.
 *
 * Fix: idempotent events (focus-update, raise-float) opt in
 * to coalescing by name; window-first-frame is per window and never coalesces.
 * The queue's timeout is captured so each test can step it one tick at a time.
 */
describe("Bug forge-2hbi: the event queue coalesces idempotent events", () => {
  let ctx, wm, ticks;
  const realTimeoutAdd = GLib.timeout_add;

  beforeEach(() => {
    ticks = [];
    GLib.timeout_add = (priority, interval, cb) => {
      ticks.push({ interval, cb });
      return ticks.length;
    };
    ctx = createWindowManagerFixture();
    wm = ctx.windowManager;
  });

  afterEach(() => {
    GLib.timeout_add = realTimeoutAdd;
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  /** Run the queue source one tick; returns false once it removes itself. */
  const tick = () => ticks[ticks.length - 1].cb();

  /** Track a window; returns it with its actor's "first-frame" handler. */
  function trackWindow(wm_class) {
    const metaWindow = createMockWindow({ wm_class, workspace: ctx.workspaces[0] });
    let firstFrame;
    vi.spyOn(metaWindow.get_compositor_private(), "connect").mockImplementation((signal, cb) => {
      if (signal === "first-frame") firstFrame = cb;
      return 1;
    });
    // The window-created path: track, holding move() back until the first frame.
    wm._awaitFirstFrame(metaWindow, () => wm.trackWindow(null, metaWindow));
    return { metaWindow, firstFrame };
  }

  /** Drop whatever tracking queued, so each test starts from an empty queue. */
  function drainQueue() {
    while (wm._queueSourceId && tick());
  }

  it("runs a burst of focus-update events once", () => {
    const { metaWindow: a } = trackWindow("A");
    drainQueue();
    const focusUpdate = vi.spyOn(wm, "movePointerWith");

    for (let i = 0; i < 30; i++) a.emit("focus", a);

    expect(tick()).toBe(false);
    expect(focusUpdate).toHaveBeenCalledTimes(1);
  });

  it("runs each window-first-frame queued behind the burst on the next ticks", () => {
    const { metaWindow: a, firstFrame: aFirstFrame } = trackWindow("A");
    const { firstFrame: bFirstFrame } = trackWindow("B");
    drainQueue();
    const firstFrameRenders = vi.spyOn(wm, "renderTree");

    for (let i = 0; i < 30; i++) a.emit("focus", a);
    aFirstFrame();
    bFirstFrame();
    firstFrameRenders.mockClear();

    tick(); // the coalesced focus-update
    expect(tick()).toBe(true);
    expect(tick()).toBe(false);
    const fromFirstFrame = firstFrameRenders.mock.calls.filter(
      ([from]) => from === "window-first-frame"
    );
    expect(fromFirstFrame).toHaveLength(2);
  });
});
