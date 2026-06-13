import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle, GrabOp, MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-hs6l
 *
 * Tree.next() returns the NUMBER -1 sentinel at a monitor boundary (single /
 * outermost monitor). nextVisible() used to pass that -1 through unchanged.
 * _handleResizing then treated the primitive -1 as a resize-pair node and
 * assigned `.percent` on it, throwing a TypeError on every size-changed event.
 *
 * Scenario: single monitor, three windows side-by-side in an HSPLIT; the
 * rightmost is FLOAT. Resizing the middle window's RIGHT edge walks past the
 * floating last sibling and hits the monitor boundary.
 *
 * Fix: nextVisible() normalizes the -1 sentinel to null.
 */
describe("Bug forge-hs6l - resize toward a floating last sibling", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { GrabOp, MotionDirection };
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  it("nextVisible returns null (not the -1 sentinel) at a monitor boundary", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    const left = ctx.tree.createNode(
      monitor.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ workspace: workspace0() })
    );
    left.mode = WINDOW_MODES.TILE;
    const middle = ctx.tree.createNode(
      monitor.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ workspace: workspace0() })
    );
    middle.mode = WINDOW_MODES.TILE;
    const right = ctx.tree.createNode(
      monitor.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ workspace: workspace0() })
    );
    right.mode = WINDOW_MODES.FLOAT;

    // The next visible past `right` is the monitor boundary -> -1 sentinel.
    const beyond = ctx.tree.nextVisible(right, MotionDirection.RIGHT);
    expect(beyond).toBeNull();
    expect(beyond).not.toBe(-1);
  });

  it("_handleResizing does not throw dragging the middle edge toward a floating last sibling", () => {
    const metaLeft = createMockWindow({
      rect: new Rectangle({ x: 0, y: 0, width: 640, height: 1080 }),
      workspace: workspace0(),
    });
    const metaMiddle = createMockWindow({
      rect: new Rectangle({ x: 640, y: 0, width: 640, height: 1080 }),
      workspace: workspace0(),
    });
    const metaRight = createMockWindow({
      rect: new Rectangle({ x: 1280, y: 0, width: 640, height: 1080 }),
      workspace: workspace0(),
    });

    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    const left = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaLeft);
    left.mode = WINDOW_MODES.TILE;
    left.percent = 0.5;
    left.rect = { x: 0, y: 0, width: 640, height: 1080 };

    const middle = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaMiddle);
    middle.mode = WINDOW_MODES.TILE;
    middle.percent = 0.5;
    middle.initRect = { x: 640, y: 0, width: 640, height: 1080 };
    middle.rect = { x: 640, y: 0, width: 640, height: 1080 };
    middle.initGrabOp = GrabOp.RESIZING_E;

    // Rightmost is FLOAT and is the last child: the resize-pair walk runs off
    // the end of the HSPLIT into the monitor boundary.
    const right = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaRight);
    right.mode = WINDOW_MODES.FLOAT;
    right.percent = 0.5;
    right.rect = { x: 1280, y: 0, width: 640, height: 1080 };

    metaMiddle._frameRect = new Rectangle({ x: 640, y: 0, width: 800, height: 1080 });

    wm().grabOp = GrabOp.RESIZING_E;
    global.display.get_focus_window.mockReturnValue(metaMiddle);

    expect(() => wm()._handleResizing(middle)).not.toThrow();
  });
});
