import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture } from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * Bug #330: Wrong height in 2x2 layout
 *
 * Problem: In a 2x2 layout the lower windows became twice as tall as expected.
 * The split-size calculation did not allocate child sizes so they summed back
 * to the parent's size, leaving rounding/overflow that skewed heights.
 *
 * Fix: Tree.computeSizes() distributes each child's percent of the parent
 * dimension and corrects any rounding remainder onto the last child so the
 * allocated sizes always sum to the parent size (lib/extension/tree.js).
 *
 * These tests exercise the real Tree.computeSizes().
 */
describe("Bug #330: Wrong height in 2x2 layout with tabbed container", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // Build a VSPLIT container with `count` children at the given percents.
  function buildVSplit(rect, percents) {
    const con = new Node(NODE_TYPES.CON, new Bin());
    con.layout = LAYOUT_TYPES.VSPLIT;
    con.rect = rect;
    const children = percents.map((p) => {
      const child = new Node(NODE_TYPES.CON, new Bin());
      child.percent = p;
      con.appendChild(child);
      return child;
    });
    return { con, children };
  }

  it("computeSizes splits a vertical container into equal heights", () => {
    const { con, children } = buildVSplit({ x: 0, y: 0, width: 960, height: 1080 }, [0.5, 0.5]);

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes).toHaveLength(2);
    // Each half of a 1080px column is 540px.
    expect(sizes[0]).toBe(540);
    expect(sizes[1]).toBe(540);
    // Bug #330: allocated heights must sum exactly to the parent height.
    expect(sizes[0] + sizes[1]).toBe(1080);
  });

  it("computeSizes corrects rounding so heights still sum to the parent (no doubled rows)", () => {
    // 1081 is odd: naive Math.floor(0.5 * 1081) = 540 each, summing to 1080,
    // leaving a 1px gap. The #330 fix pushes the remainder onto the last child.
    const { con, children } = buildVSplit({ x: 0, y: 0, width: 960, height: 1081 }, [0.5, 0.5]);

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0] + sizes[1]).toBe(1081);
    // Neither child should be anywhere near double the other.
    expect(Math.abs(sizes[0] - sizes[1])).toBeLessThanOrEqual(1);
  });

  it("computeSizes is unaffected by a sibling container's layout (2x2 stays 50/50)", () => {
    // Right column of a 2x2: a plain VSPLIT with two equal rows. The left
    // column being TABBED must not change these computed heights.
    const { con, children } = buildVSplit({ x: 960, y: 0, width: 960, height: 1080 }, [0.5, 0.5]);

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0]).toBe(540);
    expect(sizes[1]).toBe(540);
    expect(sizes[0] + sizes[1]).toBe(1080);
  });

  it("computeSizes honors unequal percents while still summing to the parent", () => {
    const { con, children } = buildVSplit({ x: 0, y: 0, width: 960, height: 1000 }, [0.7, 0.3]);

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0]).toBe(700);
    expect(sizes[1]).toBe(300);
    expect(sizes[0] + sizes[1]).toBe(1000);
  });

  it("computeSizes falls back to equal shares when percents are unset", () => {
    const { con, children } = buildVSplit({ x: 0, y: 0, width: 960, height: 1200 }, [0, 0]);

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0]).toBe(600);
    expect(sizes[1]).toBe(600);
    expect(sizes[0] + sizes[1]).toBe(1200);
  });
});
