import { describe, it, expect, beforeEach, vi } from "vitest";
import GLib from "gi://GLib";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * forge-ext/forge#565: GNOME shows a Wayland window at its old place until the
 * app has drawn its new size, while X11 windows move at once. When one window
 * grew into the space a slower neighbour was giving up, it was drawn over that
 * neighbour until the app caught up; while a resize key repeated, for seconds.
 * moveAll() holds a window back until the windows still covering its new place
 * have left: a gap meanwhile, never an overlap.
 */
describe("#565: a window waits for a slower neighbour to leave its new place", () => {
  let ctx;
  let timers;
  let now;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "focus-on-hover-enabled": false },
    });
    timers = [];
    now = 1_000_000;
    vi.spyOn(GLib, "get_monotonic_time").mockImplementation(() => now);
    vi.spyOn(GLib, "timeout_add").mockImplementation((priority, interval, callback) => {
      timers.push({ interval, callback });
      return timers.length;
    });
  });

  const wm = () => ctx.windowManager;

  // A tiled window Forge has placed before. A slow one keeps its old frame until draw()
  function placedWindow(rect, { slow = false } = {}) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const metaWindow = createMockWindow({
      workspace: ctx.workspaces[0],
      rect: new Rectangle(rect),
    });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    metaWindow.forgePendingFrame = { ...rect, time: 0 };
    const requests = [];
    let asked = null;
    vi.spyOn(metaWindow, "move_resize_frame").mockImplementation((_i, x, y, width, height) => {
      requests.push({ x, y, width, height });
      asked = new Rectangle({ x, y, width, height });
      if (!slow) metaWindow._rect = asked;
    });
    const draw = () => {
      metaWindow._rect = asked;
    };
    return { metaWindow, requests, draw };
  }

  // The frame checks that moveAll() schedules while windows wait
  const runFrameChecks = () => {
    const pending = timers.filter((t) => t.interval === 16);
    timers = timers.filter((t) => t.interval !== 16);
    pending.forEach((t) => {
      if (t.callback()) timers.push(t);
    });
  };

  it("moves the window giving up space first, and the other once it has left", () => {
    const left = placedWindow({ x: 0, y: 40, width: 1000, height: 1000 }, { slow: true });
    const right = placedWindow({ x: 1000, y: 40, width: 900, height: 1000 });

    // Right grows to the left into the space left gives up
    wm().moveAll([
      [right.metaWindow, { x: 600, y: 40, width: 1300, height: 1000 }],
      [left.metaWindow, { x: 0, y: 40, width: 600, height: 1000 }],
    ]);
    expect(left.requests).toHaveLength(1);
    expect(right.requests).toHaveLength(0);

    runFrameChecks();
    expect(right.requests).toHaveLength(0); // left's app hasn't drawn yet

    left.draw();
    runFrameChecks();
    expect(right.requests).toEqual([{ x: 600, y: 40, width: 1300, height: 1000 }]);
  });

  it("doesn't wait for long on an app that never redraws", () => {
    const left = placedWindow({ x: 0, y: 40, width: 1000, height: 1000 }, { slow: true });
    const right = placedWindow({ x: 1000, y: 40, width: 900, height: 1000 });

    wm().moveAll([
      [right.metaWindow, { x: 600, y: 40, width: 1300, height: 1000 }],
      [left.metaWindow, { x: 0, y: 40, width: 600, height: 1000 }],
    ]);
    now += 400_000;
    runFrameChecks();
    expect(right.requests).toHaveLength(0);

    now += 200_000;
    runFrameChecks();
    expect(right.requests).toHaveLength(1);
  });

  it("moves two windows that swap places at once", () => {
    const a = placedWindow({ x: 0, y: 40, width: 960, height: 1000 }, { slow: true });
    const b = placedWindow({ x: 960, y: 40, width: 960, height: 1000 }, { slow: true });

    wm().moveAll([
      [a.metaWindow, { x: 960, y: 40, width: 960, height: 1000 }],
      [b.metaWindow, { x: 0, y: 40, width: 960, height: 1000 }],
    ]);

    expect(a.requests).toHaveLength(1);
    expect(b.requests).toHaveLength(1);
  });

  it("places a window that just opened right away", () => {
    const left = placedWindow({ x: 0, y: 40, width: 1920, height: 1000 }, { slow: true });
    const fresh = placedWindow({ x: 400, y: 200, width: 800, height: 600 });
    fresh.metaWindow.forgePendingFrame = null;

    wm().moveAll([
      [left.metaWindow, { x: 0, y: 40, width: 960, height: 1000 }],
      [fresh.metaWindow, { x: 960, y: 40, width: 960, height: 1000 }],
    ]);

    expect(fresh.requests).toHaveLength(1);
  });

  it("a direct move replaces a queued one", () => {
    const left = placedWindow({ x: 0, y: 40, width: 1000, height: 1000 }, { slow: true });
    const right = placedWindow({ x: 1000, y: 40, width: 900, height: 1000 });

    wm().moveAll([
      [right.metaWindow, { x: 600, y: 40, width: 1300, height: 1000 }],
      [left.metaWindow, { x: 0, y: 40, width: 600, height: 1000 }],
    ]);
    wm().move(right.metaWindow, { x: 1200, y: 40, width: 700, height: 1000 });
    left.draw();
    runFrameChecks();

    expect(right.requests).toEqual([{ x: 1200, y: 40, width: 700, height: 1000 }]);
  });
});
