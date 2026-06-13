import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-yyum: a tiled window the user pins "Always on Visible Workspace" (sticky)
 * is shown by Mutter on every workspace, but the tree can only home a window
 * under one workspace's container. Mutter reports the ACTIVE workspace for a
 * sticky window, so the re-home reconcile kept inserting it into whatever
 * workspace was active — churning tile sizes across every visited workspace.
 *
 * Fix: treat a sticky window as a Z-axis overlay and float it (mirroring the
 * Always-on-Top rule). A float reserves no tile space and is painted on every
 * workspace, so there is no bounce and no overlap; un-pinning re-tiles it.
 */
describe("forge-yyum: sticky windows float instead of churning tiles", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  it("isFloatingExempt is true for a sticky window and false for a normal one", () => {
    const normal = createMockWindow({ wm_class: "App", title: "Doc" });
    const sticky = createMockWindow({ wm_class: "App", title: "Doc" });
    sticky.stick();

    expect(wm().isFloatingExempt(normal)).toBe(false);
    expect(wm().isFloatingExempt(sticky)).toBe(true);
  });

  it("processFloats demotes a tiled window to float once it becomes sticky", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const metaWindow = createMockWindow({ wm_class: "App", title: "Doc" });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;

    // Sanity: a normal tiled window stays tiled and counts toward the layout.
    wm().processFloats();
    expect(node.isFloat()).toBe(false);
    expect(ctx.tree.getTiledChildren(monitor.childNodes)).toContain(node);

    // User pins "Always on Visible Workspace": it floats out of the tile grid.
    metaWindow.stick();
    wm().processFloats();
    expect(node.isFloat()).toBe(true);
    expect(ctx.tree.getTiledChildren(monitor.childNodes)).not.toContain(node);
  });
});
