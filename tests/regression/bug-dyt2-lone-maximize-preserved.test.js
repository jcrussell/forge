import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * forge-dyt2: a lone tiled window's external maximize is kept by the signal path
 * (_shouldRejectExternalMaximize deliberately exempts the lone case) but silently
 * reverted by the next renderTree -> tree.apply -> move(), which unmaximizes any
 * window with getMaximizeFlags != 0. So the maximize survived until some later
 * event, then snapped back — the guards and the render pipeline disagreed.
 *
 * Fix: tree.apply skips re-slicing a lone maximized tiled window (via the shared
 * _tiledWindowsOnMonitor predicate), the same way it already skips fullscreen.
 * Multi-window maximize is still re-tiled (handled/reverted by
 * _shouldRejectExternalMaximize at signal time).
 */
describe("forge-dyt2: tree.apply preserves a lone tiled window's maximize", () => {
  let ctx;

  beforeEach(() => {
    // window-maximize-on-single OFF, else handleMaximizeOnSingle re-maximizes and
    // masks the revert. tiling-mode-enabled ON so the predicates engage.
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "window-maximize-on-single": false },
    });
  });

  afterEach(() => ctx.cleanup());

  function tileWindow(monitor, id) {
    const metaWindow = createMockWindow({
      id,
      rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
      workspace: ctx.workspaces[0],
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    node.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    node.renderRect = { x: 0, y: 0, width: 1920, height: 1080 };
    return { metaWindow, node };
  }

  it("does not unmaximize the sole tiled window on render", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const { metaWindow, node } = tileWindow(monitor, 7001);

    metaWindow.maximize();
    metaWindow.move_resize_frame(false, 0, 0, 1920, 1080);

    // The signal path intentionally leaves the lone maximize alone.
    expect(ctx.windowManager._shouldRejectExternalMaximize(node, metaWindow)).toBe(false);

    ctx.tree.apply(ctx.tree);
    expect(metaWindow.is_maximized()).toBe(true);

    // Convergence: repeated renders keep it maximized (no unmaximize<->maximize loop).
    ctx.tree.apply(ctx.tree);
    ctx.tree.apply(ctx.tree);
    expect(metaWindow.is_maximized()).toBe(true);
  });

  it("still re-tiles (unmaximizes) a maximized window when it is NOT alone", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    const { metaWindow: win1, node: node1 } = tileWindow(monitor, 7101);
    tileWindow(monitor, 7102); // second tiled window -> not lone
    node1.renderRect = { x: 0, y: 0, width: 960, height: 1080 };

    win1.maximize();

    // With a sibling present the lone exemption does not apply; apply re-slices it.
    expect(ctx.windowManager._isLoneMaximizedTile(node1)).toBe(false);
    ctx.tree.apply(ctx.tree);
    expect(win1.is_maximized()).toBe(false);
  });
});
