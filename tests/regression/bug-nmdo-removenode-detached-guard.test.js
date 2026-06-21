import { describe, it, expect, beforeEach } from "vitest";
import {
  getWorkspaceAndMonitor,
  createTreeFixture,
  createWindowNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-nmdo: removeNode read node.parentNode.childNodes (and
 * parentNode.parentNode.removeChild) with no null guard. removeChild nulls
 * parentNode after detaching, so an already-detached node — handed in by a
 * malformed/partially-built tree or a reordered cleanup sequence — threw a
 * TypeError mid-cleanTree, aborting the destroy handler and leaving a
 * half-cleaned tree for the next render.
 *
 * Fix: bail (return false) at the top when the node has no parent.
 */
describe("Bug forge-nmdo: removeNode guards an already-detached node", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true, settings: { "tiling-mode-enabled": true } });
  });

  it("returns false without throwing when the node has no parent", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const w = createWindowNode(ctx.tree, monitor).nodeWindow;

    // Detach it: removeChild nulls parentNode.
    monitor.removeChild(w);
    expect(w.parentNode).toBe(null);

    let result;
    expect(() => {
      result = ctx.tree.removeNode(w);
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("returns false without throwing for a null node", () => {
    expect(() => ctx.tree.removeNode(null)).not.toThrow();
    expect(ctx.tree.removeNode(null)).toBe(false);
  });
});
