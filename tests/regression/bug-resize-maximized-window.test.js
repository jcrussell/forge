import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle, GrabOp } from "../mocks/gnome/Meta.js";

/**
 * A resize shortcut on a maximized window grew it from its full-screen frame:
 * for a frame it covered its neighbours and the top bar, then the next render
 * put it back in its slot. The first press now only restores it.
 */
describe("Keyboard resize of a maximized window", () => {
  let ctx;
  let win1;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    win1 = createMockWindow({
      id: 5101,
      allows_resize: true,
      rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
    });
    const win2 = createMockWindow({
      id: 5102,
      allows_resize: true,
      rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
    });
    [win1, win2].forEach((w) => {
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, w);
      node.mode = WINDOW_MODES.TILE;
    });
    ctx.display.get_focus_window.mockReturnValue(win1);
    ctx.windowManager.trackCurrentMonWs = () => {};
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  it("restores the window instead of growing it from its maximized frame", () => {
    win1.maximize();
    const moveSpy = vi.spyOn(ctx.windowManager, "move");
    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree").mockImplementation(() => {});

    ctx.windowManager.resize(GrabOp.KEYBOARD_RESIZING_N, 15);

    expect(win1.is_maximized()).toBe(false);
    expect(moveSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalled();
  });
});

/**
 * The restore must leave no keyboard-resize state behind: a later pointer resize
 * of the same window still turns its frame into percents (and lays out the
 * neighbours) instead of being skipped as an in-progress keyboard resize.
 */
describe("Pointer resize after a keyboard restore", () => {
  let ctx;
  let win1;
  let node1;
  let node2;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    win1 = createMockWindow({
      id: 5201,
      allows_resize: true,
      rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
    });
    const win2 = createMockWindow({
      id: 5202,
      allows_resize: true,
      rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
    });
    [node1, node2] = [win1, win2].map((w) => {
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, w);
      node.mode = WINDOW_MODES.TILE;
      return node;
    });
    node1.rect = { x: 0, y: 0, width: 960, height: 1080 };
    node2.rect = { x: 960, y: 0, width: 960, height: 1080 };
    ctx.display.get_focus_window.mockReturnValue(win1);
    ctx.windowManager.trackCurrentMonWs = () => {};
    ctx.windowManager.calculateGaps = () => 0;
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  it("changes the window's share and lays out its neighbour", () => {
    const wm = ctx.windowManager;
    win1.maximize();
    const renderSpy = vi.spyOn(wm, "renderTree").mockImplementation(() => {});
    wm.resize(GrabOp.KEYBOARD_RESIZING_E, 15);
    renderSpy.mockClear();

    // The restored window, back in its slot, is then resized with the pointer
    win1._rect = new Rectangle({ x: 0, y: 0, width: 960, height: 1080 });
    wm._handleGrabOpBegin(global.display, win1, GrabOp.RESIZING_E);
    win1._rect = new Rectangle({ x: 0, y: 0, width: 1160, height: 1080 });
    wm.updateMetaPositionSize(win1, "size-changed");

    expect(node1.percent).toBeGreaterThan(0.5);
    expect(node1.percent + node2.percent).toBeCloseTo(1, 5);
    expect(renderSpy).toHaveBeenCalledWith("resize-live");
  });
});
