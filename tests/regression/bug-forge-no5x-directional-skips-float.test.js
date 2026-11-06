import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../mocks/helpers/index.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-no5x: Tree.next() returned the raw tree sibling whatever its mode, and
 * new windows (floats included) are inserted right after the focused one, so
 * [A, F(float), B] is common. Move/Swap-Right on A swapped it with F (moving the
 * float onto A's tile and trading percents) and Focus-Right landed on F instead of
 * B. _swappable accepted a floating partner too, so WindowSwapLastActive swapped
 * the focused tile with a floating last-active window.
 *
 * Fix: directional next() steps over floating siblings; _swappable rejects floats.
 */
describe("Bug forge-no5x: directional ops skip floating tree siblings", () => {
  let ctx;
  let a, f, b;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    const wm = ctx.windowManager;
    wm.move = vi.fn();
    wm.movePointerWith = vi.fn();
    wm.renderTree = vi.fn();

    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const workspace = ctx.workspaces[0];
    const add = (id, mode = "TILE") =>
      createWindowNode(ctx.tree, monitor, { windowOverrides: { id, workspace }, mode }).nodeWindow;
    a = add(9101);
    f = add(9102, "FLOAT");
    b = add(9103);
    a.percent = 0.7;
    b.percent = 0.3;
  });

  afterEach(() => ctx.cleanup());

  const order = () => a.parentNode.childNodes;

  const expectFloatUntouched = () => {
    expect(f.mode).toBe(WINDOW_MODES.FLOAT);
    const movedWindows = ctx.windowManager.move.mock.calls.map((c) => c[0]);
    expect(movedWindows).not.toContain(f.nodeValue);
  };

  it("move(A, RIGHT) swaps A with the tiled B, not the float", () => {
    expect(ctx.tree.move(a, MotionDirection.RIGHT)).toBe(true);

    expect(order().indexOf(a)).toBeGreaterThan(order().indexOf(b));
    expectFloatUntouched();
    expect(a.percent).toBe(0.3);
    expect(b.percent).toBe(0.7);
  });

  it("swap(A, RIGHT) swaps A with the tiled B, not the float", () => {
    expect(ctx.tree.swap(a, MotionDirection.RIGHT)).toBe(b);

    expect(order().indexOf(a)).toBeGreaterThan(order().indexOf(b));
    expectFloatUntouched();
  });

  it("move(B, RIGHT) at the tiled edge is a no-op that keeps percents", () => {
    // [A, F, B] → B is the rightmost tiled child; the float after it is no neighbour.
    b.parentNode.appendChild(f);
    expect(ctx.tree.move(b, MotionDirection.RIGHT)).toBe(true);

    expect(a.percent).toBe(0.7);
    expect(b.percent).toBe(0.3);
  });

  it("focus(A, RIGHT) focuses B", () => {
    expect(ctx.tree.focus(a, MotionDirection.RIGHT)).toBe(b);
  });

  it("WindowSwapLastActive with a floating last-active window leaves both in place", () => {
    ctx.display.get_focus_window.mockReturnValue(a.nodeValue);
    ctx.display.get_tab_next = vi.fn(() => f.nodeValue);

    ctx.windowManager.command({ name: "WindowSwapLastActive" });

    expect(order()).toEqual([a, f, b]);
    expect(a.mode).toBe(WINDOW_MODES.TILE);
    expectFloatUntouched();
  });
});

describe("Bug forge-no5x: directional focus into another monitor skips floats", () => {
  let ctx;
  let a, f0, f1, b;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: {
        display: {
          monitorCount: 2,
          monitorGeometries: [
            { x: 0, y: 0, width: 1920, height: 1080 },
            { x: 1920, y: 0, width: 1920, height: 1080 },
          ],
        },
      },
    });
    const wm = ctx.windowManager;
    wm.move = vi.fn();
    wm.movePointerWith = vi.fn();
    wm.renderTree = vi.fn();

    const workspace = ctx.workspaces[0];
    const add = (monitorIndex, id, mode = "TILE") => {
      const { monitor } = getWorkspaceAndMonitor(ctx, 0, monitorIndex);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      return createWindowNode(ctx.tree, monitor, {
        windowOverrides: { id, workspace, monitor: monitorIndex },
        mode,
      }).nodeWindow;
    };
    // Monitor 0: [A, F0(float)]; monitor 1: [F1(float), B]. Each float sits on
    // the edge that focus enters its monitor from.
    a = add(0, 9201);
    f0 = add(0, 9202, "FLOAT");
    f1 = add(1, 9203, "FLOAT");
    b = add(1, 9204);
  });

  afterEach(() => ctx.cleanup());

  it("focus(A, RIGHT) enters the next monitor at B, not its first-child float", () => {
    expect(ctx.tree.focus(a, MotionDirection.RIGHT)).toBe(b);
  });

  it("focus(B, LEFT) enters the previous monitor at A, not its last-child float", () => {
    expect(ctx.tree.focus(b, MotionDirection.LEFT)).toBe(a);
  });

  it("focus(A, RIGHT) still enters a monitor that holds only floats", () => {
    b.mode = "FLOAT";

    expect(ctx.tree.focus(a, MotionDirection.RIGHT)).toBe(f1);
  });
});
