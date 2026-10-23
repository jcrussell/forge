import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES, ORIENTATION_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle, MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * forge-ext/forge#546, #550: a resize must stop where the neighbour reaches its
 * minimum size, and resizing the edge of a container must not move the borders
 * inside it that the user did not touch.
 */
describe("Bug #546/#550: resize pair bounds and nested containers", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  const tile = (parent, size_hints = null) => {
    const metaWindow = createMockWindow({ rect: new Rectangle({}), size_hints });
    const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return node;
  };

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    wm().calculateGaps = () => 0;
  });

  it("stops at the neighbour's minimum size", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const a = tile(monitor);
    const b = tile(monitor, { min_width: 400, min_height: 0 });
    // 1000 px shared; growing A to 900 would leave B 100 px, below its 400 minimum
    expect(wm()._clampPairSize(a, b, 500, 500, 900, ORIENTATION_TYPES.HORIZONTAL)).toBe(600);
    expect(wm()._clampPairSize(a, b, 500, 500, 550, ORIENTATION_TYPES.HORIZONTAL)).toBe(550);
  });

  it("finds the pair past a tabbed group, in the split along the edge", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = tile(monitor);
    const tabbed = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, null);
    tabbed.layout = LAYOUT_TYPES.TABBED;
    const c = tile(tabbed);
    const split = ctx.tree.createNode(tabbed.nodeValue, NODE_TYPES.CON, null);
    split.layout = LAYOUT_TYPES.HSPLIT;
    const b = tile(split);
    tile(split);

    expect(wm()._resizePairFor(b, MotionDirection.LEFT)).toBe(a);
    expect(wm()._resizePairFor(c, MotionDirection.LEFT)).toBe(a);
    expect(wm()._resizePairFor(a, MotionDirection.LEFT)).toBe(null);
  });

  it("keeps the siblings of the resized window inside the container", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    tile(monitor);
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, null);
    con.layout = LAYOUT_TYPES.HSPLIT;
    const b = tile(con);
    const c = tile(con);
    con.rect = { x: 500, y: 0, width: 1000, height: 1000 };
    b.rect = { x: 500, y: 0, width: 500, height: 1000 };
    c.rect = { x: 1000, y: 0, width: 500, height: 1000 };

    // B's left edge moves 200 px left: the container grows to 1200, C stays 500
    wm()._resizeSharesAlongPath(b, con, 1200, "width");

    expect(b.percent * 1200).toBeCloseTo(700);
    expect(c.percent * 1200).toBeCloseTo(500);
  });
});
