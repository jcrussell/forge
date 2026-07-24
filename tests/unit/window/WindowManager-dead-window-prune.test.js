import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  finalizeWindow,
} from "../../mocks/helpers/index.js";

/**
 * renderTree self-heal against dead window nodes (forge-4b6)
 *
 * The render idle callback has no catch: before the prune, one finalized
 * Meta.Window wrapper in the tree made processFloats throw out of the
 * callback on EVERY render, so tiling died shell-wide (new windows never
 * tiled, toggles/gaps/maximize silently no-op'd). renderTree must prune dead
 * nodes first and complete the pass for the live windows.
 *
 * finalizeWindow() finalizes the node's own Meta.Window in place: any method
 * (incl. isWindowAlive's get_id() probe) throws, like the real dead wrapper.
 */

describe("WindowManager - dead-window prune on render", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("renderTree survives a dead window node and prunes it", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const live1 = createWindowNode(ctx.tree, monitor, {});
    const dead = createWindowNode(ctx.tree, monitor, {});
    const live2 = createWindowNode(ctx.tree, monitor, {});
    finalizeWindow(dead.nodeWindow.nodeValue);

    // The GLib mock runs the idle callback synchronously, so this executes
    // prune + processFloats + tree.render inline.
    expect(() => ctx.windowManager.renderTree("dead-window-test", true)).not.toThrow();

    const remaining = ctx.tree.getNodeByType(NODE_TYPES.WINDOW);
    expect(remaining).toHaveLength(2);
    expect(remaining).toContain(live1.nodeWindow);
    expect(remaining).toContain(live2.nodeWindow);
  });
});
