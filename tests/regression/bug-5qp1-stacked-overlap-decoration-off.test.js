import { describe, it, expect, beforeEach, afterEach } from "vitest";
import St from "gi://St";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture } from "../mocks/helpers/index.js";

/**
 * forge-5qp1: Stacked layout — children fully overlap (no header offset) when
 * the tab decoration is disabled.
 *
 * When `showtab-decoration-enabled` is OFF, processNode sets
 * params.stackedHeight = 0, so every stacked child receives the FULL container
 * rect (no vertical title-bar offset) and the decoration host is hidden. This
 * is intentional and consistent with TABBED mode (which also hides its bar when
 * the setting is off). Siblings can still be cycled by keyboard
 * (focus/swap next-prev, directional focus). This test pins the by-design
 * behavior so it cannot silently regress into a partial/garbage offset.
 */
describe("forge-5qp1: stacked overlap when tab decoration disabled", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    ctx.extWm.calculateGaps = () => 0;
  });

  afterEach(() => ctx.cleanup());

  it("gives every stacked child the full container rect when stackedHeight is 0", () => {
    const container = new Node(NODE_TYPES.CON, new St.Bin());
    container.layout = LAYOUT_TYPES.STACKED;
    container.rect = { x: 0, y: 0, width: 1000, height: 800 };

    const child1 = new Node(NODE_TYPES.CON, new St.Bin());
    const child2 = new Node(NODE_TYPES.CON, new St.Bin());
    const child3 = new Node(NODE_TYPES.CON, new St.Bin());
    container.childNodes = [child1, child2, child3];

    // stackedHeight 0 mirrors showtab-decoration-enabled = false.
    const params = { stackedHeight: 0, tiledChildren: [child1, child2, child3] };

    ctx.tree.processStacked(container, child1, params, 0);
    ctx.tree.processStacked(container, child2, params, 1);
    ctx.tree.processStacked(container, child3, params, 2);

    // No header offset: each child fully overlaps the whole container.
    [child1, child2, child3].forEach((child) => {
      expect(child.rect.x).toBe(0);
      expect(child.rect.y).toBe(0);
      expect(child.rect.width).toBe(1000);
      expect(child.rect.height).toBe(800);
    });
  });

  it("hides the decoration host when stackedHeight is 0", () => {
    const container = new Node(NODE_TYPES.CON, new St.Bin());
    container.layout = LAYOUT_TYPES.STACKED;
    container.rect = { x: 0, y: 0, width: 1000, height: 800 };

    const child = new Node(NODE_TYPES.CON, new St.Bin());
    const sibling = new Node(NODE_TYPES.CON, new St.Bin());
    container.childNodes = [child, sibling];

    ctx.tree.processStacked(
      container,
      child,
      { stackedHeight: 0, tiledChildren: [child, sibling] },
      0
    );

    expect(container.decoration.visible).toBe(false);
  });
});
