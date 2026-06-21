import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createContainerNode,
} from "../mocks/helpers/index.js";
import { Rectangle, GrabOp, MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-34c6: in the non-sameParent (cross-container) branch of
 * _handleResizing, parentNodeForFocus = resizePairForWindow.parentNode
 * .childNodes[index] where index = resizePairForWindow.index ± 1. At a parent
 * boundary (first child + AFTER -> index -1, or last child + BEFORE -> past end)
 * childNodes[index] is undefined and the subsequent `.rect` read throws a
 * TypeError inside the live size-changed handler — the existing `!firstRect`
 * guard runs too late (after the deref).
 *
 * Fix: bail on a falsy parentNodeForFocus before reading .rect.
 */
describe("Bug forge-34c6: cross-container resize at a parent boundary does not throw", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { GrabOp, MotionDirection };
  });

  afterEach(() => ctx.cleanup());

  it("returns instead of throwing when the resize pair is the first child of its parent", () => {
    const wm = ctx.windowManager;
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    // Focused window in the monitor (parent A).
    const mw1 = createMockWindow({
      rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
      workspace: ctx.workspaces[0],
    });
    const w1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, mw1);
    w1.mode = WINDOW_MODES.TILE;
    w1.percent = 0.5;
    w1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
    w1.rect = { x: 0, y: 0, width: 960, height: 1080 };
    w1.initGrabOp = GrabOp.RESIZING_E;

    // Sibling container (parent B) with two tiled children. Its FIRST child is
    // the resize pair, so RESIZING_E (position AFTER) computes index 0 - 1 = -1.
    const conB = createContainerNode(monitor, LAYOUT_TYPES.VSPLIT, {
      x: 960,
      y: 0,
      width: 960,
      height: 1080,
    });
    const mw2 = createMockWindow({
      rect: new Rectangle({ x: 960, y: 0, width: 960, height: 540 }),
      workspace: ctx.workspaces[0],
    });
    const w2 = ctx.tree.createNode(conB.nodeValue, NODE_TYPES.WINDOW, mw2);
    w2.mode = WINDOW_MODES.TILE;
    w2.rect = { x: 960, y: 0, width: 960, height: 540 };
    const mw3 = createMockWindow({
      rect: new Rectangle({ x: 960, y: 540, width: 960, height: 540 }),
      workspace: ctx.workspaces[0],
    });
    const w3 = ctx.tree.createNode(conB.nodeValue, NODE_TYPES.WINDOW, mw3);
    w3.mode = WINDOW_MODES.TILE;

    expect(w2.index).toBe(0); // boundary: index - 1 = -1

    // Force the resize pair to be conB's first child (a different parent than w1).
    vi.spyOn(ctx.tree, "nextVisible").mockReturnValue(w2);

    wm.grabOp = GrabOp.RESIZING_E;
    global.display.get_focus_window.mockReturnValue(mw1);
    mw1.move_resize_frame(false, 0, 0, 1100, 1080);

    expect(() => wm._handleResizing(w1)).not.toThrow();
  });
});
