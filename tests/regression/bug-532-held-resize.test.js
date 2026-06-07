import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle, GrabOp } from "../mocks/gnome/Meta.js";

/**
 * forge-5v6 (#532): holding the keyboard resize shortcut only resized one step.
 *
 * Each key auto-repeat calls resize(), which used to enqueue a one-shot
 * grab-end on the shared event queue. The grab (and its frozen initRect) tore
 * down between repeats, so the resize never accumulated. The fix restarts a
 * single debounced grab-end on each call, keeping the grab open for the whole
 * hold so the resize accumulates and settles once on release.
 *
 * NOTE: the GLib timeout mock does not fire, so this asserts the debounce
 * MECHANISM (the grab stays open and accumulates across rapid calls). The
 * end-to-end "continuous resize" behaviour is covered by the e2e gate.
 */
describe("Bug #532: held resize keeps the grab open and accumulates", () => {
  let ctx;
  let win1;
  let node1;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };

    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;

    win1 = createMockWindow({
      id: 5001,
      title: "Left",
      allows_resize: true,
      rect: new Rectangle({ x: 0, y: 0, width: 300, height: 600 }),
    });
    const win2 = createMockWindow({
      id: 5002,
      title: "Right",
      allows_resize: true,
      rect: new Rectangle({ x: 300, y: 0, width: 300, height: 600 }),
    });
    node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win1);
    const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win2);
    node1.mode = WINDOW_MODES.TILE;
    node2.mode = WINDOW_MODES.TILE;
    node1.percent = 0.5;
    node2.percent = 0.5;

    ctx.display.get_focus_window.mockReturnValue(win1);
    // Bypass monitor/workspace plumbing not under test here.
    ctx.windowManager.trackCurrentMonWs = () => {};
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  it("does not end the grab between rapid repeats (single frozen initRect)", () => {
    const amount = 10;
    ctx.windowManager.resize(GrabOp.KEYBOARD_RESIZING_E, amount);
    const firstInit = node1.initRect;
    expect(firstInit).toBeTruthy();

    ctx.windowManager.resize(GrabOp.KEYBOARD_RESIZING_E, amount);
    ctx.windowManager.resize(GrabOp.KEYBOARD_RESIZING_E, amount);

    // The grab is still open: initRect is preserved (same object), not reset.
    expect(node1.initRect).toBe(firstInit);
    // A single debounced grab-end is pending (the fix), and the shared event
    // queue is NOT used per-repeat (the old behaviour).
    expect(ctx.windowManager._manualResizeEndId).toBeTruthy();
    expect(ctx.windowManager.eventQueue.length).toBe(0);
  });

  it("accumulates the resize across repeats instead of one step", () => {
    const amount = 10;
    const startWidth = win1.get_frame_rect().width;

    ctx.windowManager.resize(GrabOp.KEYBOARD_RESIZING_E, amount);
    ctx.windowManager.resize(GrabOp.KEYBOARD_RESIZING_E, amount);
    ctx.windowManager.resize(GrabOp.KEYBOARD_RESIZING_E, amount);

    // Three presses grew the window by 3 steps, not one.
    expect(win1.get_frame_rect().width).toBe(startWidth + 3 * amount);
  });
});
