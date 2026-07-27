import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle, GrabOp } from "../mocks/gnome/Meta.js";

/**
 * forge-h6z9: the debounced keyboard-resize grab-end (_manualResizeEndId) was a
 * single instance-wide timer not scoped to its window/grab.
 *
 * (1) Restart-across-windows: a keyboard resize on window A armed the timer; a
 *     resize on window B within 120ms removed A's pending end and only cleaned
 *     B, stranding A's node with grabMode=RESIZING and a frozen initRect.
 * (2) End-fires-into-new-grab: a real pointer grab beginning <120ms after a
 *     keyboard resize was not protected; the delayed _handleGrabOpEnd fired
 *     into the live drag and killed it.
 *
 * Fix: track which window the pending end belongs to, flush the prior window's
 * grab on a cross-window re-arm, and cancel the pending timer in
 * _handleGrabOpBegin. The same-window key-repeat path (forge-5v6) must keep
 * accumulating (covered by bug-532).
 */
describe("forge-h6z9: manual resize debounce scoped to its window/grab", () => {
  let ctx;
  let winA;
  let nodeA;
  let winB;
  let nodeB;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };

    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;

    winA = createMockWindow({
      id: 9001,
      title: "A",
      allows_resize: true,
      rect: new Rectangle({ x: 0, y: 0, width: 300, height: 600 }),
    });
    winB = createMockWindow({
      id: 9002,
      title: "B",
      allows_resize: true,
      rect: new Rectangle({ x: 300, y: 0, width: 300, height: 600 }),
    });
    nodeA = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, winA);
    nodeB = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, winB);
    nodeA.mode = WINDOW_MODES.TILE;
    nodeB.mode = WINDOW_MODES.TILE;
    nodeA.percent = 0.5;
    nodeB.percent = 0.5;

    // Bypass monitor/workspace plumbing not under test here.
    ctx.windowManager.trackCurrentMonWs = () => {};
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  const wm = () => ctx.windowManager;
  const focus = (win) => ctx.display.get_focus_window.mockReturnValue(win);

  it("flushes window A's grab when a resize on window B re-arms within the debounce", () => {
    focus(winA);
    wm().resize(GrabOp.KEYBOARD_RESIZING_E, 10);
    expect(nodeA.grabMode).toBeTruthy();
    expect(nodeA.initRect).toBeTruthy();

    // Focus drifts to B and a second resize fires within the debounce window.
    focus(winB);
    wm().resize(GrabOp.KEYBOARD_RESIZING_E, 10);

    // A's grab state must be flushed, not stranded.
    expect(nodeA.grabMode).toBeNull();
    expect(nodeA.initRect).toBeNull();

    // B is now the one tracked by the pending end.
    expect(nodeB.grabMode).toBeTruthy();
    expect(nodeB.initRect).toBeTruthy();
  });

  it("_handleGrabOpBegin cancels a pending manual-resize end so it can't fire into a new grab", () => {
    focus(winA);
    wm().resize(GrabOp.KEYBOARD_RESIZING_E, 10);
    expect(wm()._manualResizeEndId).toBeTruthy();

    // A real pointer grab begins on the same window <120ms later.
    wm()._handleGrabOpBegin(ctx.display, winA, GrabOp.MOVING);

    expect(wm()._manualResizeEndId).toBeFalsy();
  });

  // forge-zr6f: the cross product h6z9 left uncovered. Its flush lived inside
  // resize(), so it only fired for keyboard->keyboard. A real pointer grab on a
  // DIFFERENT window arrives via the grab-op-begin signal instead, which cleared
  // the timer without cleaning A.
  describe("forge-zr6f: a pointer grab on another window still flushes A", () => {
    it("clears A's grab state instead of stranding grabMode", () => {
      focus(winA);
      wm().resize(GrabOp.KEYBOARD_RESIZING_E, 10);
      expect(nodeA.grabMode).toBeTruthy();

      // User clicks/drags window B within the 120ms debounce. Mutter emits
      // grab-op-begin with focus already moved to B.
      focus(winB);
      wm()._handleGrabOpBegin(ctx.display, winB, GrabOp.MOVING);

      expect(nodeA.grabMode).toBeNull();
      expect(nodeA.initRect).toBeNull();
    });

    it("leaves A reachable by move() again (the user-visible symptom)", () => {
      focus(winA);
      wm().resize(GrabOp.KEYBOARD_RESIZING_E, 10);

      focus(winB);
      wm()._handleGrabOpBegin(ctx.display, winB, GrabOp.MOVING);
      wm()._handleGrabOpEnd(ctx.display, winB, GrabOp.MOVING);

      // With grabMode stranded, forge-r2k9's guard in move() skipped A on every
      // tree.apply(), so A kept stale geometry while its siblings reflowed.
      const target = { x: 10, y: 20, width: 200, height: 400 };
      const commit = vi.spyOn(winA, "move_resize_frame");
      wm().move(winA, target);

      expect(commit).toHaveBeenCalled();
    });

    it("does NOT flush on same-window key auto-repeat (accumulation preserved)", () => {
      focus(winA);
      wm().resize(GrabOp.KEYBOARD_RESIZING_E, 10);
      const firstInit = nodeA.initRect;

      // Key held: resize() re-enters _handleGrabOpBegin for the SAME window.
      wm().resize(GrabOp.KEYBOARD_RESIZING_E, 10);
      wm().resize(GrabOp.KEYBOARD_RESIZING_E, 10);

      // Identity, not equality: a flush would null it and re-anchor to the
      // already-grown frame, which is the forge-12f/forge-5v6 breakage.
      expect(nodeA.initRect).toBe(firstInit);
      expect(nodeA.grabMode).toBeTruthy();
    });
  });
});
