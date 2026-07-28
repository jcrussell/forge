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
 * Bug forge-b602: in the cross-container branch of _handleResizing, once
 * parentNodeForFocus = resizePairForWindow.parentNode.childNodes[index] resolves
 * to a live node, the code reads `parentNodeForFocus.parentNode.rect` and calls
 * `_normalizeSiblingPercents(parentNodeForFocus.parentNode)`. The forge-34c6
 * guard only checked parentNodeForFocus itself, not its parentNode — a resolved
 * sibling whose parentNode is null (detached/finalized while still lingering in
 * the childNodes array) throws a TypeError inside the live size-changed handler.
 *
 * Fix: guard `!parentNodeForFocus.parentNode` alongside the forge-34c6 bail
 * before dereferencing.
 */
describe("Bug forge-b602: cross-container resize with a null grandparent does not throw", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { GrabOp, MotionDirection };
  });

  afterEach(() => ctx.cleanup());

  it("returns instead of throwing when the resolved pair node has a null parentNode", () => {
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

    // Sibling container (parent B) with two tiled children.
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
    w3.rect = { x: 960, y: 540, width: 960, height: 540 };

    // Resize pair is conB's SECOND child, so RESIZING_E (position AFTER) computes
    // index 1 - 1 = 0 -> parentNodeForFocus = conB.childNodes[0] = w2 (non-null).
    expect(w3.index).toBe(1);
    // Detach w2 from the tree while it still lingers in conB.childNodes: its
    // parentNode is now null, so parentNodeForFocus.parentNode.rect would throw.
    w2.parentNode = null;

    vi.spyOn(ctx.tree, "nextVisible").mockReturnValue(w3);

    wm.grabOp = GrabOp.RESIZING_E;
    global.display.get_focus_window.mockReturnValue(mw1);
    mw1.move_resize_frame(false, 0, 0, 1100, 1080);

    expect(() => wm._handleResizing(w1)).not.toThrow();
  });
});
