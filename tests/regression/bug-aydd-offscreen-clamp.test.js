import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * forge-aydd: move() only repositioned windows whose min-size exceeded their slot
 * (Bug #117). A rect whose right/bottom edge ran past the work area from any other
 * path — keyboard resize() of a float, rectForMonitor() onto a smaller monitor —
 * was committed as-is, stranding the window off-screen. move() should keep the
 * committed frame within the work area (position-only, never shrinking the window).
 * Work area in the mock is {x:0, y:0, width:1920, height:1080}.
 */
describe("forge-aydd: off-screen clamp for the general placement path", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  it("shifts a window left/up when its rect overflows the right/bottom edge", () => {
    const win = createMockWindow();
    // x+width = 2100 > 1920 and y+height = 1200 > 1080.
    wm().move(win, new Rectangle({ x: 1800, y: 1000, width: 300, height: 200 }));

    const frame = win.get_frame_rect();
    expect(frame.x + 300).toBeLessThanOrEqual(1920);
    expect(frame.y + 200).toBeLessThanOrEqual(1080);
  });

  it("leaves an on-screen window's position unchanged", () => {
    const win = createMockWindow();
    wm().move(win, new Rectangle({ x: 100, y: 100, width: 800, height: 600 }));

    const frame = win.get_frame_rect();
    expect(frame.x).toBe(100);
    expect(frame.y).toBe(100);
  });
});
