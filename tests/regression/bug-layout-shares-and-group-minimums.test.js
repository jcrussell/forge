import { describe, it, expect, beforeEach } from "vitest";
import St from "gi://St";
import { Node, NODE_TYPES, LAYOUT_TYPES, ORIENTATION_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Found by the nested fuzz test:
 * - A minimized, maximized or floated window keeps its share for when it comes
 *   back, so the others' percents sum to less than 1; computeSizes gave all the
 *   missing space to one window instead of scaling them together.
 * - A stacked or tabbed group's minimum height left out its title bars, so its
 *   windows were laid out below their minimum height.
 */
describe("Layout shares and group minimum sizes", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "showtab-decoration-enabled": true, "stacked-tab-bar-height": 35 },
    });
    ctx.windowManager.calculateGaps = () => 0;
  });

  it("scales the shares of the windows still tiled together", () => {
    const container = new Node(NODE_TYPES.CON, new St.Bin());
    container.layout = LAYOUT_TYPES.HSPLIT;
    container.rect = { x: 0, y: 0, width: 1000, height: 500 };
    const b = new Node(NODE_TYPES.CON, new St.Bin());
    const c = new Node(NODE_TYPES.CON, new St.Bin());
    // A (0.4) is minimized: B and C keep 0.4 and 0.2
    b.percent = 0.4;
    c.percent = 0.2;

    expect(ctx.tree.computeSizes(container, [b, c])).toEqual([666, 334]);
  });

  it("counts a stacked group's title bars in its minimum height", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const group = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());
    group.layout = LAYOUT_TYPES.STACKED;
    [1, 2].forEach((id) => {
      const w = createMockWindow({
        id,
        rect: new Rectangle({}),
        size_hints: { min_width: 0, min_height: 200 },
      });
      ctx.tree.createNode(group.nodeValue, NODE_TYPES.WINDOW, w).mode = WINDOW_MODES.TILE;
    });

    const bar = ctx.tree.stackedBarHeight();
    expect(ctx.tree._minSizeInOrientation(group, ORIENTATION_TYPES.VERTICAL)).toBe(200 + 2 * bar);
    group.layout = LAYOUT_TYPES.TABBED;
    expect(ctx.tree._minSizeInOrientation(group, ORIENTATION_TYPES.VERTICAL)).toBe(200 + bar);
    expect(ctx.tree._minSizeInOrientation(group, ORIENTATION_TYPES.HORIZONTAL)).toBe(0);
  });
});

describe("Percents put back to a sum of 1 when every child is tiled", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  it("scales drifted percents back to 1", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const nodes = [1, 2].map((id) => {
      const n = ctx.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        createMockWindow({ id, rect: new Rectangle({}) })
      );
      n.mode = WINDOW_MODES.TILE;
      return n;
    });
    nodes[0].percent = 0.414;
    nodes[1].percent = 0.263;

    ctx.tree._healPercents(monitor, nodes);

    expect(nodes[0].percent + nodes[1].percent).toBeCloseTo(1, 5);
    expect(nodes[0].percent / nodes[1].percent).toBeCloseTo(0.414 / 0.263, 5);
  });

  it("leaves the shares alone while a child is away (minimized, maximized, floating)", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const nodes = [1, 2, 3].map((id) => {
      const n = ctx.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        createMockWindow({ id, rect: new Rectangle({}) })
      );
      n.mode = WINDOW_MODES.TILE;
      n.percent = 1 / 3;
      return n;
    });

    ctx.tree._healPercents(monitor, nodes.slice(1));

    expect(nodes[1].percent).toBeCloseTo(1 / 3, 5);
  });
});
