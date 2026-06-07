import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Bug #117: legacy apps with a large minimum width keep their slot's x but grow past
 * the work-area edge, pushing the top-right close button off screen. move() should
 * shift such a window left so it stays fully within the work area. Work area in the
 * mock is {x:0, y:0, width:1920, height:1080}.
 */
describe("Bug #117: off-screen clamp for min-size-constrained windows", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  it("shifts a window left when its min-width exceeds its slot and would overflow the edge", () => {
    const win = createMockWindow({ size_hints: { min_width: 500, min_height: 100 } });
    // Slot hugs the right edge: x+width is on-screen, but min-width (500) would overflow.
    wm().move(win, new Rectangle({ x: 1600, y: 0, width: 300, height: 1080 }));

    // x must be clamped so x + min_width <= 1920.
    expect(win.get_frame_rect().x).toBe(1420);
  });

  it("leaves a normal window's slot position unchanged when it fits", () => {
    const win = createMockWindow({ size_hints: { min_width: 200, min_height: 100 } });
    wm().move(win, new Rectangle({ x: 1600, y: 0, width: 300, height: 1080 }));

    expect(win.get_frame_rect().x).toBe(1600);
  });

  it("leaves position unchanged when the window exposes no size hints", () => {
    const win = createMockWindow(); // size_hints defaults to null
    wm().move(win, new Rectangle({ x: 1600, y: 0, width: 300, height: 1080 }));

    expect(win.get_frame_rect().x).toBe(1600);
  });
});
