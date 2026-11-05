import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-0ym6 (gh-564): stacked focus stored "which member is shown" by moving
 * the focused window to the end of the stack (updateStackedFocus appendChild).
 * Directional focus walks that same child order, so every step rewrote the
 * order the next one walked: in STACKED[A,B,C] with C focused, Super+K went
 * B, C, B, C and A was unreachable. Move's settle callback did the same, so a
 * move within a stack snapped back.
 *
 * Fix: the stack order stays fixed; the shown member is tracked (lastTabFocus)
 * and raised instead.
 */
describe("forge-0ym6: a stack keeps its order on focus and move", () => {
  let ctx;
  let wins;
  let monitor;
  let pending;
  const realTimeoutAdd = GLib.timeout_add;

  beforeEach(() => {
    pending = [];
    GLib.timeout_add = (priority, interval, cb) => {
      pending.push(cb);
      return pending.length;
    };
    ctx = createWindowManagerFixture();
    ({ monitor } = getWorkspaceAndMonitor(ctx, 0, 0));
    monitor.layout = LAYOUT_TYPES.STACKED;
    wins = ["A", "B", "C"].map((id) => {
      const win = createMockWindow({ id, wm_class: id });
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      node.mode = WINDOW_MODES.TILE;
      return win;
    });
  });

  afterEach(() => {
    GLib.timeout_add = realTimeoutAdd;
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  // Drain the queued event sources like the GLib main loop.
  function flush() {
    while (pending.length) {
      const cb = pending.shift();
      if (cb() === true) pending.push(cb);
    }
  }

  // Press `name` <direction> with `from` focused; returns the window Focus moved to.
  function press(name, direction, from) {
    ctx.display.get_focus_window.mockReturnValue(from);
    const focusSpy = vi.spyOn(ctx.tree, "focus");
    ctx.windowManager.command({ name, direction });
    flush();
    const target = focusSpy.mock.results[0]?.value?.nodeValue;
    focusSpy.mockRestore();
    return target;
  }

  const order = () => monitor.childNodes.map((n) => n.nodeValue);

  it("Focus up twice from C reaches A and leaves the order untouched", () => {
    const [A, B, C] = wins;

    const first = press("Focus", "up", C);
    expect(first).toBe(B);
    expect(press("Focus", "up", first)).toBe(A);

    expect(order()).toEqual([A, B, C]);
    expect(monitor.lastTabFocus).toBe(A);
  });

  it("Focus down walks A, B, C in order", () => {
    const [A, B, C] = wins;
    expect(press("Focus", "down", A)).toBe(B);
    expect(press("Focus", "down", B)).toBe(C);
  });

  it("Move up within the stack keeps the moved order once the move settles", () => {
    const [A, B, C] = wins;
    press("Move", "up", C);

    expect(order()).toEqual([A, C, B]);
  });
});
