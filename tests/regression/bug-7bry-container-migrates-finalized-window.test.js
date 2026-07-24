import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  finalizeWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-7bry: _containerFullyMigrates (reached via the _queueWindowHomeReconcile
 * idle, which has no try/catch) called metaWindow.get_workspace() on the caller's
 * window with no isWindowAlive() probe. A window closing during a multi-workspace
 * shift finalizes the wrapper, so get_workspace() throws and skips that reconcile's
 * renderTree.
 *
 * Fix: probe Utils.isWindowAlive(metaWindow) up front, consistent with the
 * per-node guard already inside the .every().
 */
describe("Bug forge-7bry: _containerFullyMigrates guards a finalized window", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("returns false without throwing when the moved window is finalized", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    // A populated container node so the method gets past the !node guard.
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 9001 }));

    const dead = createMockWindow({ id: 9002 });
    finalizeWindow(dead);

    let result;
    expect(() => {
      result = ctx.windowManager._containerFullyMigrates(monitor, dead);
    }).not.toThrow();
    expect(result).toBe(false);
  });
});
