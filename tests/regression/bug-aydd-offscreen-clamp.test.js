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

/**
 * Multi-monitor regression (#1): getWorkAreaSafe() returns the work area of the
 * window's CURRENT monitor. When move() targets a DIFFERENT monitor with no
 * explicit workArea arg, the forge-aydd clamp checked the destination rect
 * against the wrong (source) monitor's edge and snapped the window back onto the
 * source monitor. The clamp must resolve the work area from the TARGET rect's
 * monitor instead. Two monitors side-by-side: A = {x:0..1920}, B = {x:1920..3840}.
 */
describe("forge-aydd: off-screen clamp resolves the target monitor (multi-monitor)", () => {
  let ctx;

  // Window stays "on" monitor 0 (get_work_area_current_monitor → A); the move
  // targets monitor 1 (B). Two monitors to the right of each other.
  beforeEach(() => {
    ctx = createWindowManagerFixture({ globals: { display: { monitorCount: 2 } } });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  it("preserves a rect fully on the right-hand monitor (no false clamp)", () => {
    const win = createMockWindow({ monitor: 0 });
    // Rect lives entirely on monitor B (x:1920..3840). Against monitor A this
    // rect's right edge (2800) overflows 1920, so the old clamp snapped x back
    // to ~1120; with the target-monitor work area it must stay put.
    wm().move(win, new Rectangle({ x: 2000, y: 100, width: 800, height: 600 }));

    const frame = win.get_frame_rect();
    expect(frame.x).toBe(2000);
    expect(frame.y).toBe(100);
  });

  it("preserves a rect on a monitor below (vertical neighbor)", () => {
    // Stack monitor B directly below monitor A.
    ctx.cleanup();
    ctx = createWindowManagerFixture({
      globals: {
        display: {
          monitorGeometries: [
            { x: 0, y: 0, width: 1920, height: 1080 },
            { x: 0, y: 1080, width: 1920, height: 1080 },
          ],
        },
      },
    });
    // Active workspace's per-monitor work area must match the below layout.
    const ws = ctx.workspaceManager.get_active_workspace();
    ws.get_work_area_for_monitor = (idx) =>
      new Rectangle({ x: 0, y: idx * 1080, width: 1920, height: 1080 });

    const win = createMockWindow({ monitor: 0 });
    // Rect entirely on the lower monitor (y:1080..2880). Against monitor A its
    // bottom (1780) overflows 1080 -> old clamp snapped y back onto A.
    wm().move(win, new Rectangle({ x: 100, y: 1200, width: 800, height: 600 }));

    const frame = win.get_frame_rect();
    expect(frame.x).toBe(100);
    expect(frame.y).toBe(1200);
  });

  it("still clamps a window overflowing the right edge of its OWN monitor", () => {
    // Window on monitor 0 with a rect that targets monitor 0 but spills past its
    // right edge -> same-monitor clamp must still pull it back on-screen.
    const win = createMockWindow({ monitor: 0 });
    wm().move(win, new Rectangle({ x: 1800, y: 1000, width: 300, height: 200 }));

    const frame = win.get_frame_rect();
    expect(frame.x + 300).toBeLessThanOrEqual(1920);
    expect(frame.y + 200).toBeLessThanOrEqual(1080);
  });
});
