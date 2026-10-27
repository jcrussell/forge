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
 * On Wayland GNOME applies the position Forge asks for only together with a size
 * the app drew. When the slots were narrower than the apps' minimums (too many
 * windows side by side), Forge asked for less than the minimum, the app drew its
 * minimum, and the position was dropped: every render repeated the same request,
 * so the windows stayed stuck over each other. Some apps (Chrome, tabby) draw
 * 1 px more than their own minimum, so asking for the minimum is not enough.
 */
describe("a window whose app draws another size still reaches its position", () => {
  let ctx;
  let timers;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "focus-on-hover-enabled": false },
    });
    timers = [];
    vi.spyOn(GLib, "timeout_add").mockImplementation((priority, interval, callback) => {
      timers.push({ interval, callback });
      return timers.length;
    });
  });

  const wm = () => ctx.windowManager;

  // A tiled window at x=1000 whose app draws `drawWidth` whatever it is asked for,
  // and, like GNOME on Wayland, drops the position that came with that request.
  function stubbornWindow({ minWidth, drawWidth }) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const metaWindow = createMockWindow({
      workspace: ctx.workspaces[0],
      rect: new Rectangle({ x: 1000, y: 40, width: drawWidth, height: 800 }),
      size_hints: { min_width: minWidth, min_height: 100 },
    });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    const requests = [];
    vi.spyOn(metaWindow, "move_resize_frame").mockImplementation((_i, x, y, width, height) => {
      requests.push({ x, y, width, height });
      const frame = metaWindow.get_frame_rect();
      metaWindow._rect = new Rectangle({ x: frame.x, y: frame.y, width: drawWidth, height });
    });
    const moveFrame = vi.spyOn(metaWindow, "move_frame");
    return { metaWindow, requests, moveFrame };
  }

  const runTimer = () => timers.shift()?.callback();

  it("never asks for less than the app's minimum", () => {
    const { metaWindow, requests } = stubbornWindow({ minWidth: 500, drawWidth: 500 });

    wm().move(metaWindow, { x: 400, y: 40, width: 380, height: 800 });

    expect(requests[0].width).toBe(500);
  });

  it("moves the window without resizing once the app drew another size", () => {
    const { metaWindow, moveFrame } = stubbornWindow({ minWidth: 500, drawWidth: 640 });
    // The app drew 640 instead of the 500 asked for: the position was dropped
    metaWindow._rect = new Rectangle({ x: 1000, y: 40, width: 700, height: 800 });

    wm().move(metaWindow, { x: 400, y: 40, width: 500, height: 800 });
    expect(metaWindow.get_frame_rect().x).toBe(1000);

    runTimer();

    expect(moveFrame).toHaveBeenCalledWith(true, 400, 40);
    expect(metaWindow.get_frame_rect().x).toBe(400);
  });

  it("waits for a slow app before moving it, then moves it anyway", () => {
    const { metaWindow, moveFrame } = stubbornWindow({ minWidth: 500, drawWidth: 501 });
    // Still drawing its old size: it may just be slow (moving it now would make it slide)
    vi.spyOn(metaWindow, "move_resize_frame").mockImplementation(() => {});

    wm().move(metaWindow, { x: 400, y: 40, width: 500, height: 800 });
    runTimer();
    runTimer();
    expect(moveFrame).not.toHaveBeenCalled();

    runTimer();
    expect(moveFrame).toHaveBeenCalledWith(true, 400, 40);
    expect(timers).toHaveLength(0);
  });

  it("leaves a window alone when a newer request replaced the one checked", () => {
    const { metaWindow, moveFrame } = stubbornWindow({ minWidth: 500, drawWidth: 640 });

    wm().move(metaWindow, { x: 400, y: 40, width: 500, height: 800 });
    const stale = timers.shift();
    wm().move(metaWindow, { x: 300, y: 40, width: 500, height: 800 });

    stale.callback();
    expect(moveFrame).not.toHaveBeenCalled();
    while (timers.length) runTimer();
    expect(moveFrame).toHaveBeenCalledTimes(1);
    expect(moveFrame).toHaveBeenCalledWith(true, 300, 40);
  });

  it("does nothing when the position landed", () => {
    const { metaWindow, moveFrame } = stubbornWindow({ minWidth: 500, drawWidth: 640 });
    vi.spyOn(metaWindow, "move_resize_frame").mockImplementation((_i, x, y) => {
      metaWindow._rect = new Rectangle({ x, y, width: 640, height: 800 });
    });

    wm().move(metaWindow, { x: 400, y: 40, width: 500, height: 800 });
    runTimer();

    expect(moveFrame).not.toHaveBeenCalled();
    expect(timers).toHaveLength(0);
  });
});
