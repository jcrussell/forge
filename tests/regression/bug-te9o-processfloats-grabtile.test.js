import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-te9o: processFloats clobbers GRAB_TILE -> TILE mid-drag.
 *
 * A window being dragged is put in WINDOW_MODES.GRAB_TILE and the renderer is
 * frozen. But renderTree's force path unfreezes and schedules the render idle,
 * which runs processFloats. processFloats set `nodeWindow.float = false` on every
 * non-exempt tiled window, and the float setter unconditionally writes mode = TILE
 * -- silently clobbering GRAB_TILE, so the drop path (gated on GRAB_TILE) no-ops
 * and the window snaps back.
 *
 * Fix: processFloats skips GRAB_TILE nodes, mirroring getTiledChildren's exclusion.
 */
describe("Bug forge-te9o: processFloats preserves GRAB_TILE", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("does not demote a GRAB_TILE (mid-drag) node to TILE", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const dragged = createMockWindow({ wm_class: "App1", id: 1001, allows_resize: true });
    const sibling = createMockWindow({ wm_class: "App2", id: 1002, allows_resize: true });
    const draggedNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dragged);
    const siblingNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, sibling);

    siblingNode.mode = WINDOW_MODES.TILE;
    draggedNode.mode = WINDOW_MODES.GRAB_TILE;

    ctx.windowManager.processFloats();

    expect(draggedNode.isGrabTile()).toBe(true);
    // The regular tiled sibling is still processed normally.
    expect(siblingNode.isTile()).toBe(true);
  });
});
