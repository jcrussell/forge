import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture, createMockWindow } from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * Bug forge-l8av (audit-2026-07 / C11): when the sum of children's minimum sizes
 * exceeds the container, _redistributeForMinSizes falls back to
 * sizes[i] = floor(mins[i] / minTotal * total). A child with minimum 0 gets 0px, and
 * apply() skips zero-width/height rects — so that window is never placed and keeps its
 * stale geometry, overlapping its siblings.
 *
 * Fix: guarantee every child a placeable (>0) rect in the unsatisfiable fallback,
 * keeping the sum exact so the #330 remainder-fold can't push it back to 0.
 */
describe("Bug forge-l8av: over-constrained split still places a min-0 child", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture();
  });

  afterEach(() => ctx.cleanup());

  function buildSplit(layout, rect, specs) {
    const con = new Node(NODE_TYPES.CON, new Bin());
    con.layout = layout;
    con.rect = rect;
    const children = specs.map((spec, i) => {
      const metaWindow = createMockWindow({
        id: `w${i}`,
        rect: new Rectangle(rect),
        size_hints: { min_width: spec.min_width ?? 0, min_height: spec.min_height ?? 0 },
      });
      const child = new Node(NODE_TYPES.WINDOW, metaWindow);
      child.percent = spec.percent ?? 1 / specs.length;
      con.appendChild(child);
      return child;
    });
    return { con, children };
  }

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  it("gives the min-0 child a nonzero width and keeps the sum exact", () => {
    const { con, children } = buildSplit(
      LAYOUT_TYPES.HSPLIT,
      { x: 0, y: 0, width: 1200, height: 1080 },
      [{ min_width: 700 }, { min_width: 550 }, { min_width: 0 }]
    );

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes.every((s) => s > 0)).toBe(true);
    expect(sizes[2]).toBeGreaterThan(0);
    expect(sum(sizes)).toBe(1200);
  });
});
