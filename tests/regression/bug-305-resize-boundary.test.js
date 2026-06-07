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
 * forge-12f (#305): dragging one boundary must not move the opposite boundary.
 * With [W1 | W2 | W3] tiled in one container, dragging the W1/W2 boundary moves
 * only that boundary; W3 on the far side stays put. Drives the real
 * _handleResizing() path so the percent math is exercised end to end.
 *
 * Rect convention (matches tree.js render): a window node's `.rect` is the full
 * layout slice (gaps included); the window is placed on screen at
 * `renderRect` = slice - 2*gap. `initRect` = removeGapOnRect(frameRect) =
 * removeGapOnRect(renderRect) = the full slice = node.rect, so resize math runs
 * on a single consistent basis with or without gaps.
 */
describe("Bug #305: Resize keeps the non-adjacent boundary fixed", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  // Build [W1 | W2 | W3] in an HSPLIT monitor 900 wide. node.rect is the full
  // slice (300 each); on screen each is gap-shrunk to (300 - 2*gap).
  function buildThree(gap) {
    if (gap) {
      ctx.settings.get_uint = (k) =>
        k === "window-gap-size" ? gap : k === "window-gap-size-increment" ? 1 : 0;
    }
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

    const nodes = [0, 1, 2].map((i) => {
      const win = createMockWindow({
        wm_class: "TestApp",
        id: 1001 + i,
        title: `W${i + 1}`,
        allows_resize: true,
        rect: new Rectangle({ x: i * 300, y: 0, width: 300, height: 600 }),
      });
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      node.mode = WINDOW_MODES.TILE;
      node.percent = 1 / 3;
      node.rect = { x: i * 300, y: 0, width: 300, height: 600 }; // full slice
      return node;
    });
    return { nodes, win1: nodes[0].nodeValue };
  }

  // Drag W1's right edge so its on-screen (gap-shrunk) width grows by `growBy`.
  function dragW1Right({ nodes, win1 }, gap, growBy) {
    const n1 = nodes[0];
    const onScreen = 300 - gap * 2;
    // initRect = removeGapOnRect(renderRect) = full slice (300).
    n1.initRect = { x: 0, y: 0, width: 300, height: 600 };
    n1.initGrabOp = GrabOp.RESIZING_E;
    ctx.windowManager.grabOp = GrabOp.RESIZING_E;
    win1.get_frame_rect = () =>
      new Rectangle({ x: gap, y: gap, width: onScreen + growBy, height: 600 - gap * 2 });
    ctx.display.get_focus_window.mockReturnValue(win1);
    ctx.windowManager._handleResizing(n1);
  }

  it("does not move W3 when resizing the W1/W2 boundary (no gaps)", () => {
    const v = buildThree(0);
    dragW1Right(v, 0, 90);

    const [n1, n2, n3] = v.nodes;
    // W1 grew, W2 shrank — the dragged boundary moved...
    expect(n1.percent).toBeGreaterThan(1 / 3);
    expect(n2.percent).toBeLessThan(1 / 3);
    // ...and W3, on the far side, did not.
    expect(n3.percent).toBeCloseTo(1 / 3, 6);
  });

  it("does not move W3 when resizing with gaps enabled", () => {
    const v = buildThree(10);
    dragW1Right(v, 10, 90);

    const [n1, n2, n3] = v.nodes;
    expect(n1.percent).toBeGreaterThan(1 / 3);
    expect(n2.percent).toBeLessThan(1 / 3);
    expect(n3.percent).toBeCloseTo(1 / 3, 6);

    // The whole row still sums to 1.0 (no overflow / understuffing).
    const total = n1.percent + n2.percent + n3.percent;
    expect(total).toBeCloseTo(1.0, 6);
  });
});
