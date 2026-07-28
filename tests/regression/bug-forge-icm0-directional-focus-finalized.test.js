import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createTiledWindow,
  finalizeWindow,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-icm0 (audit-rc-2026-07 / F5): the directional-focus path reads
 * window properties on raw-walked / structural-sibling nodes with no aliveness
 * filter, unlike the cyclic path (getTiledChildren, forge-4b6). Reachable from
 * a Focus keybinding before the idle-only prune, so a finalized wrapper's
 * `.minimized` throws and the keybinding aborts instead of moving focus.
 *
 * Two sites, one bead:
 *   - _selectFocusWindow filter (tree.js:1179)
 *   - _activateWindowNode body (tree.js:1241)
 *
 * Fix: add Utils.isWindowAlive to the filter and gate the activate body.
 */
describe("Bug forge-icm0: directional focus skips finalized nodes", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("_selectFocusWindow does not throw and drops the finalized window", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    const { nodeWindow: liveNode } = createTiledWindow(ctx, { id: 5501 });
    const { metaWindow: dead } = createTiledWindow(ctx, { id: 5502 });
    finalizeWindow(dead);

    let selected;
    expect(() => {
      selected = ctx.tree._selectFocusWindow(monitor, false);
    }).not.toThrow();
    expect(selected).toBe(liveNode);
  });

  it("_activateWindowNode returns null on a finalized node instead of throwing", () => {
    const { nodeWindow: deadNode, metaWindow: dead } = createTiledWindow(ctx, { id: 5503 });
    finalizeWindow(dead);

    let result;
    expect(() => {
      result = ctx.tree._activateWindowNode(deadNode, 0);
    }).not.toThrow();
    expect(result).toBeNull();
  });
});
