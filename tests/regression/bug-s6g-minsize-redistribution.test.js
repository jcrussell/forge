import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture } from "../mocks/helpers/index.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";
import { Rectangle } from "../mocks/gnome/Meta.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-s6g / forge-mk4 (gh-378, also #117/#271): minimum-size-aware tiling.
 *
 * Problem: Tree.computeSizes() allocated each tiled child purely from its
 * percent of the parent, ignoring window minimum sizes. A window whose
 * min-width exceeded its slice overflowed and overlapped its neighbour (the
 * #117 clamp only repositioned the window inside the work area; it never
 * enlarged the tile).
 *
 * Fix (maintainer choice: redistribute space, i3-style): computeSizes() floors
 * each child at its minimum size in the split orientation and proportionally
 * shrinks the siblings that still have slack, while preserving the Bug #330
 * invariant that the allocated sizes sum exactly to the parent size.
 *
 * These tests drive the real Tree.computeSizes().
 */
describe("forge-s6g: minimum-size-aware tiling via redistribution", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // Build an HSPLIT/VSPLIT container with WINDOW children.
  // specs: [{ percent, min_width, min_height }]
  function buildSplit(layout, rect, specs) {
    const con = new Node(NODE_TYPES.CON, new Bin());
    con.layout = layout;
    con.rect = rect;
    const children = specs.map((spec, i) => {
      const metaWindow = createMockWindow({
        id: `w${i}`,
        rect: new Rectangle(rect),
        size_hints:
          spec.min_width != null || spec.min_height != null
            ? { min_width: spec.min_width ?? 0, min_height: spec.min_height ?? 0 }
            : null,
      });
      const child = new Node(NODE_TYPES.WINDOW, metaWindow);
      child.percent = spec.percent ?? 0;
      con.appendChild(child);
      return child;
    });
    return { con, children };
  }

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  it("gives a constrained child its min width and shrinks its siblings (sum exact)", () => {
    const { con, children } = buildSplit(
      LAYOUT_TYPES.HSPLIT,
      { x: 0, y: 0, width: 1800, height: 1080 },
      [{ percent: 1 / 3, min_width: 900 }, { percent: 1 / 3 }, { percent: 1 / 3 }]
    );

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0]).toBeGreaterThanOrEqual(900);
    expect(sizes[1]).toBeLessThan(600);
    expect(sizes[2]).toBeLessThan(600);
    expect(sum(sizes)).toBe(1800);
  });

  it("satisfies two constrained siblings, third absorbs the deficit (no negatives)", () => {
    const { con, children } = buildSplit(
      LAYOUT_TYPES.HSPLIT,
      { x: 0, y: 0, width: 1800, height: 1080 },
      [{ percent: 1 / 3, min_width: 800 }, { percent: 1 / 3, min_width: 700 }, { percent: 1 / 3 }]
    );

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0]).toBeGreaterThanOrEqual(800);
    expect(sizes[1]).toBeGreaterThanOrEqual(700);
    expect(sizes.every((s) => s >= 0)).toBe(true);
    expect(sum(sizes)).toBe(1800);
  });

  it("degrades gracefully when the sum of minimums exceeds the container", () => {
    const { con, children } = buildSplit(
      LAYOUT_TYPES.HSPLIT,
      { x: 0, y: 0, width: 1800, height: 1080 },
      [
        { percent: 1 / 3, min_width: 800 },
        { percent: 1 / 3, min_width: 800 },
        { percent: 1 / 3, min_width: 800 },
      ]
    );

    const sizes = ctx.tree.computeSizes(con, children);

    // minTotal (2400) > container (1800): no negative sizes, still sums exactly,
    // and the (equal) minimums map to a roughly equal split.
    expect(sizes.every((s) => s >= 0)).toBe(true);
    expect(sum(sizes)).toBe(1800);
    sizes.forEach((s) => expect(Math.abs(s - 600)).toBeLessThanOrEqual(1));
  });

  it("uses min_height for a vertical split", () => {
    const { con, children } = buildSplit(
      LAYOUT_TYPES.VSPLIT,
      { x: 0, y: 0, width: 960, height: 1080 },
      [{ percent: 1 / 3, min_height: 700 }, { percent: 1 / 3 }, { percent: 1 / 3 }]
    );

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0]).toBeGreaterThanOrEqual(700);
    expect(sum(sizes)).toBe(1080);
  });

  it("treats a CON child and a hint-less window as min 0 (no NaN, sum exact)", () => {
    const con = new Node(NODE_TYPES.CON, new Bin());
    con.layout = LAYOUT_TYPES.HSPLIT;
    con.rect = { x: 0, y: 0, width: 1800, height: 1080 };
    const conChild = new Node(NODE_TYPES.CON, new Bin());
    conChild.percent = 0.5;
    con.appendChild(conChild);
    const winChild = new Node(
      NODE_TYPES.WINDOW,
      createMockWindow({ rect: new Rectangle({ width: 1800, height: 1080 }), size_hints: null })
    );
    winChild.percent = 0.5;
    con.appendChild(winChild);

    const sizes = ctx.tree.computeSizes(con, [conChild, winChild]);

    expect(sizes.every((s) => Number.isFinite(s))).toBe(true);
    expect(sizes[0]).toBe(900);
    expect(sizes[1]).toBe(900);
    expect(sum(sizes)).toBe(1800);
  });

  it("is a no-op when every window already fits its tile", () => {
    const { con, children } = buildSplit(
      LAYOUT_TYPES.HSPLIT,
      { x: 0, y: 0, width: 1800, height: 1080 },
      [
        { percent: 1 / 3, min_width: 100 },
        { percent: 1 / 3, min_width: 100 },
        { percent: 1 / 3, min_width: 100 },
      ]
    );

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0]).toBe(600);
    expect(sizes[1]).toBe(600);
    expect(sizes[2]).toBe(600);
    expect(sum(sizes)).toBe(1800);
  });

  it("no-hints path is byte-identical to the legacy percent allocation", () => {
    // Unequal percents, no min hints: must match the pre-change output exactly.
    const { con, children } = buildSplit(
      LAYOUT_TYPES.HSPLIT,
      { x: 0, y: 0, width: 1000, height: 1080 },
      [{ percent: 0.7 }, { percent: 0.3 }]
    );

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0]).toBe(700);
    expect(sizes[1]).toBe(300);
    expect(sum(sizes)).toBe(1000);
  });

  it("leaves a STACKED parent's computed sizes unaffected by min hints", () => {
    const { con, children } = buildSplit(
      LAYOUT_TYPES.STACKED,
      { x: 0, y: 0, width: 960, height: 1080 },
      [{ percent: 0.5, min_height: 900 }, { percent: 0.5 }]
    );

    const sizesWithHints = ctx.tree.computeSizes(con, children);

    const { con: con2, children: children2 } = buildSplit(
      LAYOUT_TYPES.STACKED,
      { x: 0, y: 0, width: 960, height: 1080 },
      [{ percent: 0.5 }, { percent: 0.5 }]
    );
    const sizesNoHints = ctx.tree.computeSizes(con2, children2);

    expect(sizesWithHints).toEqual(sizesNoHints);
  });

  it("gives a single child the full size even with a min hint", () => {
    const { con, children } = buildSplit(
      LAYOUT_TYPES.HSPLIT,
      { x: 0, y: 0, width: 1800, height: 1080 },
      [{ percent: 1, min_width: 500 }]
    );

    const sizes = ctx.tree.computeSizes(con, children);

    expect(sizes[0]).toBe(1800);
    expect(sum(sizes)).toBe(1800);
  });
});
