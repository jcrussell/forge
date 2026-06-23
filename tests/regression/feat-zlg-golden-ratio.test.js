import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Feature forge-zlg: golden-ratio resize command.
 *
 * applyGoldenRatio() resizes the focused tiled window to the golden-ratio share
 * (φ⁻¹ ≈ 0.618) of its split pair, on demand. Unlike expand()/shrink() it sets
 * an ABSOLUTE ratio on a SINGLE axis and only redistributes within the focused
 * node + its split pair, leaving other siblings in a 3+ window split untouched.
 */
const GOLDEN = 0.6180339887;

describe("Feature forge-zlg: golden-ratio resize", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  /** Build N equal-width tiled windows under the (horizontal) monitor node. */
  function buildHorizontalSplit(count) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 900, height: 600 };
    const width = 900 / count;
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const rect = new Rectangle({ x: i * width, y: 0, width, height: 600 });
      const window = createMockWindow({
        wm_class: "TestApp",
        id: 1001 + i,
        title: `Window ${i}`,
        rect,
      });
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);
      node.percent = 1 / count;
      node.rect = { x: i * width, y: 0, width, height: 600 };
      nodes.push(node);
    }
    return { monitor, nodes };
  }

  describe("_goldenRatioAgainstPair (percent math)", () => {
    it("splits a two-window row into golden / complement shares", () => {
      const { nodes } = buildHorizontalSplit(2);

      const changed = ctx.windowManager._goldenRatioAgainstPair(nodes[0]);

      expect(changed).toBe(true);
      expect(nodes[0].percent).toBeCloseTo(GOLDEN, 3);
      expect(nodes[1].percent).toBeCloseTo(1 - GOLDEN, 3);
      expect(nodes[0].percent + nodes[1].percent).toBeCloseTo(1.0, 3);
    });

    it("only redistributes within the focused node and its pair, leaving the third sibling untouched", () => {
      const { nodes } = buildHorizontalSplit(3);
      const untouchedBefore = nodes[2].percent;

      // Focus the middle window; its pair is the next sibling (nodes[2]).
      const changed = ctx.windowManager._goldenRatioAgainstPair(nodes[1]);

      expect(changed).toBe(true);
      // The first sibling (not in the pair) keeps its share.
      expect(nodes[0].percent).toBeCloseTo(1 / 3, 3);
      // Within the pair, the focused node takes the golden share.
      const pairTotal = nodes[1].percent + nodes[2].percent;
      expect(nodes[1].percent / pairTotal).toBeCloseTo(GOLDEN, 3);
      // The pair's combined share is unchanged, so the third sibling's share is
      // the same total as before the focused node grew into it.
      expect(pairTotal).toBeCloseTo(2 / 3, 3);
      expect(nodes[2].percent).toBeLessThan(untouchedBefore);
      // Everything still sums to 1.0.
      const total = nodes[0].percent + nodes[1].percent + nodes[2].percent;
      expect(total).toBeCloseTo(1.0, 3);
    });

    it("pairs the last child with its previous sibling so the focused window still gets the golden share", () => {
      const { nodes } = buildHorizontalSplit(2);

      const changed = ctx.windowManager._goldenRatioAgainstPair(nodes[1]);

      expect(changed).toBe(true);
      expect(nodes[1].percent).toBeCloseTo(GOLDEN, 3);
      expect(nodes[0].percent).toBeCloseTo(1 - GOLDEN, 3);
    });
  });

  describe("guards (no-op cases)", () => {
    it("does nothing for a single tiled window", () => {
      const { nodes } = buildHorizontalSplit(1);

      const changed = ctx.windowManager._goldenRatioAgainstPair(nodes[0]);

      expect(changed).toBe(false);
      expect(nodes[0].percent).toBeCloseTo(1.0, 3);
    });

    it("does nothing when the parent is a tabbed container", () => {
      const { monitor, nodes } = buildHorizontalSplit(2);
      monitor.layout = LAYOUT_TYPES.TABBED;
      const before = nodes.map((n) => n.percent);

      const changed = ctx.windowManager._goldenRatioAgainstPair(nodes[0]);

      expect(changed).toBe(false);
      expect(nodes[0].percent).toBeCloseTo(before[0], 5);
      expect(nodes[1].percent).toBeCloseTo(before[1], 5);
    });
  });

  describe("applyGoldenRatio (focus + render wiring)", () => {
    it("renders the tree after resizing the focused tiled window", () => {
      const { nodes } = buildHorizontalSplit(2);
      ctx.display.get_focus_window.mockReturnValue(nodes[0].nodeValue);
      let rendered = false;
      ctx.windowManager.renderTree = () => {
        rendered = true;
      };

      ctx.windowManager.applyGoldenRatio();

      expect(rendered).toBe(true);
      expect(nodes[0].percent).toBeCloseTo(GOLDEN, 3);
    });

    it("is a no-op when there is no focused window", () => {
      buildHorizontalSplit(2);
      ctx.display.get_focus_window.mockReturnValue(null);
      let rendered = false;
      ctx.windowManager.renderTree = () => {
        rendered = true;
      };

      expect(() => ctx.windowManager.applyGoldenRatio()).not.toThrow();
      expect(rendered).toBe(false);
    });
  });
});
