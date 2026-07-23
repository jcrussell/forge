import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES, GRAB_TYPES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-r2k9 (audit-2026-07 / C4): move()'s `if (metaWindow.grabbed) return;`
 * guard tested a Meta.Window property Forge never sets (only a unit test ever did),
 * so it never fired. Resize grabs don't freezeRender (freeze is MOVING+TILE only),
 * so an out-of-band renderTree reaches move() on the window being interactively
 * resized/dragged and teleports it mid-gesture.
 *
 * Fix: look up the window's node and skip move() when it is under a live grab
 * (node.grabMode set, or it is the active _draggedNodeWindow) — using Forge's own
 * grab state from _handleGrabOpBegin. Forge's own resize repositioning uses
 * move_frame() directly (not move()), so this does not block the grab itself.
 */
describe("Bug forge-r2k9: move() skips a window under a live grab", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  function trackedWindow() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const meta = createMockWindow({
      workspace: ctx.workspaces[0],
      rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta);
    node.mode = WINDOW_MODES.TILE;
    return { meta, node };
  }

  it("does not reposition a window whose node is mid-resize (grabMode set)", () => {
    const { meta, node } = trackedWindow();
    node.grabMode = GRAB_TYPES.RESIZING;
    const spy = vi.spyOn(meta, "move_resize_frame");

    ctx.windowManager.move(meta, { x: 400, y: 400, width: 500, height: 500 });

    expect(spy).not.toHaveBeenCalled();
  });

  it("still repositions a window that is not grabbed (control)", () => {
    const { meta } = trackedWindow();
    const spy = vi.spyOn(meta, "move_resize_frame");

    ctx.windowManager.move(meta, { x: 0, y: 0, width: 960, height: 540 });

    expect(spy).toHaveBeenCalled();
  });
});
