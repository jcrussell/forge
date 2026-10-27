import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES, GRAB_TYPES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { GrabOp, Rectangle } from "../mocks/gnome/Meta.js";

/**
 * forge-ext/forge#196: GNOME's own keyboard resize (Alt+F8, then the arrow
 * keys) starts as KEYBOARD_RESIZING_UNKNOWN; the first arrow picks the edge,
 * and no signal says which. The resize read no direction from the grab, so it
 * was ignored and the window snapped back when the grab ended.
 */
describe("#196: a keyboard resize started with Alt+F8 resizes the layout", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  function sideBySide() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const mkWin = (rect) => {
      const meta = createMockWindow({ workspace: ctx.workspaces[0], rect: new Rectangle(rect) });
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta);
      node.mode = WINDOW_MODES.TILE;
      node.percent = 0.5;
      node.rect = { ...rect };
      return node;
    };
    const left = mkWin({ x: 0, y: 0, width: 960, height: 1080 });
    const right = mkWin({ x: 960, y: 0, width: 960, height: 1080 });
    vi.spyOn(wm(), "calculateGaps").mockReturnValue(0);
    ctx.display.get_focus_window.mockReturnValue(left.nodeValue);
    // The grab as GNOME starts it, before an arrow key picks the edge
    wm().grabOp = GrabOp.KEYBOARD_RESIZING_UNKNOWN;
    left.grabMode = GRAB_TYPES.RESIZING;
    left.initGrabOp = GrabOp.KEYBOARD_RESIZING_UNKNOWN;
    left.initRect = { x: 0, y: 0, width: 960, height: 1080 };
    return { left, right };
  }

  it("takes the edge from the side that moved, and resizes the neighbour", () => {
    const { left, right } = sideBySide();

    // Right arrow: GNOME grew the right edge
    left.nodeValue._rect = new Rectangle({ x: 0, y: 0, width: 1060, height: 1080 });
    wm()._handleResizing(left);

    expect(wm().grabOp).toBe(GrabOp.KEYBOARD_RESIZING_E);
    expect(left.percent).toBeGreaterThan(0.5);
    expect(right.percent).toBeLessThan(0.5);
  });

  it("waits while nothing has moved yet", () => {
    const { left } = sideBySide();

    wm()._handleResizing(left);

    expect(wm().grabOp).toBe(GrabOp.KEYBOARD_RESIZING_UNKNOWN);
    expect(left.percent).toBe(0.5);
  });
});
