import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-e3xm: cross-monitor keyboard move of a min-size-constrained window
 * snapped back to the source monitor.
 *
 * During a cross-monitor move the Meta.Window is still physically on the SOURCE
 * monitor when move() runs, so get_work_area_current_monitor() returns the source
 * work area. When the destination slot is narrower than the window's min-width, the
 * old clamp resolved x inside the SOURCE work area, snapping the window back.
 *
 * Fix: move() takes an optional workArea; the MONITOR-case caller threads the target
 * monitor's work area so the clamp keeps the window on the DESTINATION monitor.
 *
 * The mock's get_work_area_current_monitor() returns the SOURCE work area
 * {x:0, width:1920}. A second monitor lives at x:1920.
 */
describe("Bug forge-e3xm: cross-monitor min-size clamp targets destination work area", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  it("clamps against the passed destination work area, not the source monitor", () => {
    // Window currently sits on the source monitor (frame differs from dest rect so
    // the skip-guard does not early-return).
    const win = createMockWindow({
      size_hints: { min_width: 500, min_height: 100 },
      rect: { x: 100, y: 0, width: 300, height: 1080 },
    });

    // Destination monitor work area (second monitor at x:1920).
    const destWorkArea = new Rectangle({ x: 1920, y: 0, width: 1920, height: 1080 });
    // Destination slot is narrower than min-width and hugs the dest right edge.
    const destRect = new Rectangle({ x: 3500, y: 0, width: 300, height: 1080 });

    wm().move(win, destRect, destWorkArea);

    const placed = win.get_frame_rect();
    // x must land inside the DESTINATION work area, clamped so x + min_width <= 3840.
    expect(placed.x).toBe(3340);
    expect(placed.x).toBeGreaterThanOrEqual(destWorkArea.x);
  });

  it("falls back to get_work_area_current_monitor() when no work area is passed", () => {
    const win = createMockWindow({
      size_hints: { min_width: 500, min_height: 100 },
      rect: { x: 100, y: 0, width: 300, height: 1080 },
    });

    // Slot hugs the source right edge; min-width (500) would overflow 1920.
    wm().move(win, new Rectangle({ x: 1600, y: 0, width: 300, height: 1080 }));

    // Legacy behavior unchanged: clamped against source work area {x:0, width:1920}.
    expect(win.get_frame_rect().x).toBe(1420);
  });
});
