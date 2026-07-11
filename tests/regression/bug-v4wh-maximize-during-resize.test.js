import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES, GRAB_TYPES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle, GrabOp } from "../mocks/gnome/Meta.js";

/**
 * forge-v4wh: a maximize/fullscreen landing inside the 120ms keyboard-resize
 * debounce was consumed as a resize delta, permanently skewing split percents.
 *
 * resize() synthesizes a grab (grabMode=RESIZING + a debounced end). If the
 * window is maximized within that window, the size-changed hits
 * updateMetaPositionSize's grabMode branch and routed to _handleResizing —
 * bypassing _shouldRejectExternalMaximize — so changePx = maximizedFrame -
 * initRect (~half the monitor) drove focus percent toward 1.0 and normalization
 * baked in a ~0.67/0.33 skew that nothing restored on unmaximize.
 *
 * Fix: the grabMode branch rejects a maximize (unmaximize + re-render, ending the
 * synthesized grab) instead of resizing, and never feeds a maximized/fullscreen
 * frame to _handleResizing.
 */
describe("forge-v4wh: maximize during keyboard-resize debounce keeps percents", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
    global.Meta = { ...(global.Meta || {}), GrabOp };
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  function buildResizingSplit() {
    const metaWindow1 = createMockWindow({
      rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
      workspace: ctx.workspaces[0],
    });
    const metaWindow2 = createMockWindow({
      rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
      workspace: ctx.workspaces[0],
    });

    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
    node1.mode = WINDOW_MODES.TILE;
    node1.percent = 0.5;
    node1.rect = { x: 0, y: 0, width: 960, height: 1080 };
    // Live keyboard-resize grab state (as _handleGrabOpBegin would leave it).
    node1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
    node1.initGrabOp = GrabOp.RESIZING_E;
    node1.grabMode = GRAB_TYPES.RESIZING;

    const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
    node2.mode = WINDOW_MODES.TILE;
    node2.percent = 0.5;
    node2.rect = { x: 960, y: 0, width: 960, height: 1080 };

    ctx.windowManager.grabOp = GrabOp.RESIZING_E;
    global.display.get_focus_window.mockReturnValue(metaWindow1);

    return { metaWindow1, node1, node2 };
  }

  it("rejects the maximize instead of skewing the split", () => {
    const { metaWindow1, node1, node2 } = buildResizingSplit();

    // The window maximizes mid-resize: full-monitor frame + maximized flags.
    metaWindow1.maximize();
    metaWindow1.move_resize_frame(false, 0, 0, 1920, 1080);

    ctx.windowManager.updateMetaPositionSize(metaWindow1, "size-changed");

    // Percents stay ~50/50 (before the fix: ~0.67/0.33).
    expect(node1.percent).toBeCloseTo(0.5, 5);
    expect(node2.percent).toBeCloseTo(0.5, 5);
    // The maximize was rejected and the synthesized grab ended.
    expect(metaWindow1.is_maximized()).toBe(false);
    expect(node1.grabMode).toBeNull();
  });

  it("still resizes normally when the window is not maximized", () => {
    const { metaWindow1, node1, node2 } = buildResizingSplit();

    // A genuine resize: frame grows 960 -> 1100, no maximize.
    metaWindow1.move_resize_frame(false, 0, 0, 1100, 1080);

    ctx.windowManager.updateMetaPositionSize(metaWindow1, "size-changed");

    expect(node1.percent).toBeGreaterThan(0.5);
    expect(node2.percent).toBeLessThan(0.5);
    expect(node1.percent + node2.percent).toBeCloseTo(1, 5);
  });
});
