import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture, createMockWindow } from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-zyx3: next()'s parent-walk `while (node.nodeType !== WORKSPACE)`
 * advances `node = node.parentNode` and reads parentNode.layout with no null
 * guard, and falls off the loop with no explicit return (implicit undefined). A
 * detached/unrooted node (concurrent removal, malformed tree) with no WORKSPACE
 * ancestor null-derefs.
 *
 * Fix: guard the walk (`if (!parentNode) return null`) and return null after it.
 */
describe("Bug forge-zyx3: next() walk on an unrooted node returns null", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true, settings: { "tiling-mode-enabled": true } });
  });

  afterEach(() => ctx.cleanup());

  it("returns null without throwing when the node has no WORKSPACE ancestor", () => {
    // Unrooted subtree: CON (parentNode null) -> WINDOW.
    const con = new Node(NODE_TYPES.CON, new Bin());
    con.layout = LAYOUT_TYPES.HSPLIT;
    const w = new Node(NODE_TYPES.WINDOW, createMockWindow({ id: 3131 }));
    con.appendChild(w);

    expect(con.parentNode).toBe(null);

    let result;
    expect(() => {
      result = ctx.tree.next(w, MotionDirection.RIGHT);
    }).not.toThrow();
    expect(result).toBe(null);
  });
});
