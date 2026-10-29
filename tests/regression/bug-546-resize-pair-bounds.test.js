import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES, ORIENTATION_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle, MotionDirection, GrabOp } from "../mocks/gnome/Meta.js";

/**
 * forge-ext/forge#546, #550: a resize must stop where the neighbour reaches its
 * minimum size, and resizing the edge of a container must not move the borders
 * inside it that the user did not touch.
 */
describe("Bug #546/#550: resize pair bounds and nested containers", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  const tile = (parent, size_hints = null) => {
    const metaWindow = createMockWindow({ rect: new Rectangle({}), size_hints });
    const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return node;
  };

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    wm().calculateGaps = () => 0;
  });

  it("stops at the neighbour's minimum size", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const a = tile(monitor);
    const b = tile(monitor, { min_width: 400, min_height: 0 });
    // 1000 px shared; growing A to 900 would leave B 100 px, below its 400 minimum
    expect(wm()._clampPairSize(a, b, 500, 500, 900, ORIENTATION_TYPES.HORIZONTAL)).toBe(600);
    expect(wm()._clampPairSize(a, b, 500, 500, 550, ORIENTATION_TYPES.HORIZONTAL)).toBe(550);
  });

  it("finds the pair past a tabbed group, in the split along the edge", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = tile(monitor);
    const tabbed = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, null);
    tabbed.layout = LAYOUT_TYPES.TABBED;
    const c = tile(tabbed);
    const split = ctx.tree.createNode(tabbed.nodeValue, NODE_TYPES.CON, null);
    split.layout = LAYOUT_TYPES.HSPLIT;
    const b = tile(split);
    tile(split);

    expect(wm()._resizePairFor(b, MotionDirection.LEFT)).toBe(a);
    expect(wm()._resizePairFor(c, MotionDirection.LEFT)).toBe(a);
    expect(wm()._resizePairFor(a, MotionDirection.LEFT)).toBe(null);
  });

  it("keeps the siblings of the resized window inside the container", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    tile(monitor);
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, null);
    con.layout = LAYOUT_TYPES.HSPLIT;
    const b = tile(con);
    const c = tile(con);
    con.rect = { x: 500, y: 0, width: 1000, height: 1000 };
    b.rect = { x: 500, y: 0, width: 500, height: 1000 };
    c.rect = { x: 1000, y: 0, width: 500, height: 1000 };

    // B's left edge moves 200 px left: the container grows to 1200, C stays 500
    wm()._resizeSharesAlongPath(b, con, 1200, "width");

    expect(b.percent * 1200).toBeCloseTo(700);
    expect(c.percent * 1200).toBeCloseTo(500);
  });
});

describe("Keyboard resize lays the window out with its neighbour", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  it("sets the shares from the requested size and lets the render place the window", () => {
    const wm = ctx.windowManager;
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const [n1, n2] = [0, 960].map((x, i) => {
      const w = createMockWindow({
        id: 5301 + i,
        allows_resize: true,
        rect: new Rectangle({ x, y: 0, width: 960, height: 1080 }),
      });
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, w);
      node.mode = WINDOW_MODES.TILE;
      node.rect = { x, y: 0, width: 960, height: 1080 };
      return node;
    });
    ctx.display.get_focus_window.mockReturnValue(n1.nodeValue);
    wm.trackCurrentMonWs = () => {};
    wm.calculateGaps = () => 0;
    const renderSpy = vi.spyOn(wm, "renderTree").mockImplementation(() => {});
    const frameSpy = vi.spyOn(n1.nodeValue, "move_resize_frame");

    wm.resize(GrabOp.KEYBOARD_RESIZING_E, 96);

    expect(n1.percent).toBeCloseTo(0.55, 5);
    expect(n2.percent).toBeCloseTo(0.45, 5);
    expect(renderSpy).toHaveBeenCalledWith("keyboard-resize");
    expect(frameSpy).not.toHaveBeenCalled();

    // The render's move() commits the keyboard-resized window despite the grab
    wm.move(n1.nodeValue, { x: 0, y: 0, width: 1056, height: 1080 });
    expect(frameSpy).toHaveBeenCalled();
  });

  function single(mode) {
    const wm = ctx.windowManager;
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const win = createMockWindow({
      id: 5401,
      allows_resize: true,
      rect: new Rectangle({ x: 100, y: 100, width: 600, height: 400 }),
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = mode;
    ctx.display.get_focus_window.mockReturnValue(win);
    wm.trackCurrentMonWs = () => {};
    wm.calculateGaps = () => 0;
    vi.spyOn(wm, "renderTree").mockImplementation(() => {});
    return { wm, win, node };
  }

  it("doesn't let a pointer resize right after a key press be moved by renders", () => {
    const wm = ctx.windowManager;
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const [n1] = [0, 960].map((x, i) => {
      const w = createMockWindow({
        id: 5601 + i,
        allows_resize: true,
        rect: new Rectangle({ x, y: 0, width: 960, height: 1080 }),
      });
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, w);
      node.mode = WINDOW_MODES.TILE;
      node.rect = { x, y: 0, width: 960, height: 1080 };
      return node;
    });
    ctx.display.get_focus_window.mockReturnValue(n1.nodeValue);
    wm.trackCurrentMonWs = () => {};
    wm.calculateGaps = () => 0;
    vi.spyOn(wm, "renderTree").mockImplementation(() => {});

    wm.resize(GrabOp.KEYBOARD_RESIZING_E, 96);
    // The user grabs the same window's edge within the 120 ms debounce
    wm._handleGrabOpBegin(global.display, n1.nodeValue, GrabOp.RESIZING_E);
    const frameSpy = vi.spyOn(n1.nodeValue, "move_resize_frame");
    wm.move(n1.nodeValue, { x: 0, y: 0, width: 1056, height: 1080 });

    expect(frameSpy).not.toHaveBeenCalled();
  });

  it("grows a held float from its frame, not a stale laid-out rect", () => {
    const { wm, win, node } = single(WINDOW_MODES.FLOAT);
    // Left over from when the window was tiled
    node.renderRect = { x: 0, y: 0, width: 960, height: 1080 };
    const frameSpy = vi.spyOn(win, "move_resize_frame");

    wm.resize(GrabOp.KEYBOARD_RESIZING_E, 50);
    wm.resize(GrabOp.KEYBOARD_RESIZING_E, 50);

    const [, x, y, width] = frameSpy.mock.calls.at(-1);
    // Two 50 px presses from its own frame, not from the stale 960 px slot at x=0
    expect([x, y, width]).toEqual([100, 100, 700]);
  });

  it("keeps a render from snapping a lone tiled window back mid-hold", () => {
    const { wm, win } = single(WINDOW_MODES.TILE);
    wm.resize(GrabOp.KEYBOARD_RESIZING_E, 50);
    const frameSpy = vi.spyOn(win, "move_resize_frame");

    // A render during the hold would put it back in its slot
    wm.move(win, { x: 0, y: 0, width: 1920, height: 1080 });

    expect(frameSpy).not.toHaveBeenCalled();
  });
});
