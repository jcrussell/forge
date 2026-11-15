import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createHorizontalLayout,
} from "../mocks/helpers/index.js";
import { WindowType } from "../mocks/gnome/Meta.js";

/**
 * Maximizing a tiled window that has neighbours (title-bar button or
 * double-click) keeps it maximized while it has focus. It stays a TILE node in its
 * slot, so it returns there when focus moves to another tiled window on the same
 * monitor: the render pipeline's move() unmaximizes it then. A single-axis
 * edge-snap is still rejected (#461).
 */
describe("maximize in tile", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "window-maximize-on-single": true },
    });
    vi.spyOn(ctx.windowManager, "updateBorderLayout").mockImplementation(() => {});
    vi.spyOn(ctx.windowManager, "updateDecorationLayout").mockImplementation(() => {});
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const wm = () => ctx.windowManager;

  function pair() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const [first, second] = createHorizontalLayout(ctx.tree, monitor, 2);
    first.nodeWindow.renderRect = { x: 0, y: 0, width: 960, height: 1080 };
    second.nodeWindow.renderRect = { x: 960, y: 0, width: 960, height: 1080 };
    return [first, second];
  }

  it("keeps the focused window maximized on size-changed", () => {
    const [first] = pair();
    first.metaWindow.maximize();
    ctx.display.get_focus_window.mockReturnValue(first.metaWindow);
    vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm().updateMetaPositionSize(first.metaWindow, "size-changed");

    expect(first.metaWindow.is_maximized()).toBe(true);
    expect(first.nodeWindow.isTile()).toBe(true);
  });

  it("keeps it maximized across renders while it has focus", () => {
    const [first] = pair();
    first.metaWindow.maximize();
    ctx.display.get_focus_window.mockReturnValue(first.metaWindow);

    ctx.tree.apply(ctx.tree);
    ctx.tree.apply(ctx.tree);

    expect(first.metaWindow.is_maximized()).toBe(true);
  });

  it("returns it to its slot when another tiled window on the monitor gets focus", () => {
    const [first, second] = pair();
    first.metaWindow.maximize();
    ctx.display.get_focus_window.mockReturnValue(second.metaWindow);

    ctx.tree.apply(ctx.tree);

    expect(first.metaWindow.is_maximized()).toBe(false);
    const rect = first.metaWindow.get_frame_rect();
    expect([rect.x, rect.width]).toEqual([0, 960]);
  });

  it("keeps it maximized while one of its dialogs has focus", () => {
    const [first] = pair();
    first.metaWindow.maximize();
    const dialog = createMockWindow({
      window_type: WindowType.DIALOG,
      transient_for: first.metaWindow,
    });
    ctx.display.get_focus_window.mockReturnValue(dialog);

    ctx.tree.apply(ctx.tree);

    expect(first.metaWindow.is_maximized()).toBe(true);
  });

  it("keeps it maximized when nothing has focus", () => {
    const [first] = pair();
    first.metaWindow.maximize();
    ctx.display.get_focus_window.mockReturnValue(null);

    ctx.tree.apply(ctx.tree);

    expect(first.metaWindow.is_maximized()).toBe(true);
  });

  it("still rejects a single-axis edge-snap on a window with neighbours", () => {
    const [first] = pair();
    first.metaWindow.maximized_vertically = true;
    ctx.display.get_focus_window.mockReturnValue(first.metaWindow);
    vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm().updateMetaPositionSize(first.metaWindow, "size-changed");

    expect(first.metaWindow.maximized_vertically).toBe(false);
  });

  it("re-slices an edge-snapped window with neighbours on render", () => {
    const [first] = pair();
    first.metaWindow.maximized_vertically = true;
    ctx.display.get_focus_window.mockReturnValue(first.metaWindow);

    ctx.tree.apply(ctx.tree);

    expect(first.metaWindow.maximized_vertically).toBe(false);
  });
});
