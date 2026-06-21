import { describe, it, expect, beforeEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createTreeFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-mo27: removeChild resolved the child to splice by node.index, but
 * gated on contains() — and those use different bases. contains() matches by
 * nodeValue (value), while index matches by identity (===). split() pushes a
 * Meta.Window into a new CON by creating a *fresh* Node with the same nodeValue
 * and leaving the original node reparented-but-not-inserted, so a stale original
 * reference yields contains()===true but index===null. splice(null, 1) coerces
 * to splice(0, 1) and silently evicted the WRONG sibling, returning a truthy
 * array so the `NodeNotFound` guard never fired.
 *
 * Fix: resolve by identity (the index getter) and never pass a null index to
 * splice; throw NodeNotFound when the node is not a direct child.
 */
describe("Bug forge-mo27: removeChild resolves the child by identity, not value", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true, settings: { "tiling-mode-enabled": true } });
  });

  it("never evicts the wrong sibling when handed a stale value-twin reference", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = createWindowNode(ctx.tree, monitor).nodeWindow;
    const b = createWindowNode(ctx.tree, monitor).nodeWindow;
    expect(monitor.childNodes).toEqual([a, b]);

    // Reproduce split()'s aftermath: a stale Node holding the SAME nodeValue as a
    // live sibling, parented to the monitor but never inserted into childNodes.
    // contains() (value-match) finds the live twin -> true; index (identity) -> null.
    const stale = new Node(NODE_TYPES.WINDOW, b.nodeValue);
    stale.parentNode = monitor;
    expect(monitor.contains(stale)).toBe(true);
    expect(stale.index).toBe(null);

    // Before the fix, splice(null, 1) collapsed to splice(0, 1) and removed `a`.
    expect(() => monitor.removeChild(stale)).toThrow();
    expect(monitor.childNodes).toEqual([a, b]);
  });

  it("still detaches a genuine direct child by identity", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = createWindowNode(ctx.tree, monitor).nodeWindow;
    const b = createWindowNode(ctx.tree, monitor).nodeWindow;

    const removed = monitor.removeChild(a);

    expect(removed).toEqual([a]);
    expect(a.parentNode).toBe(null);
    expect(monitor.childNodes).toEqual([b]);
  });
});
