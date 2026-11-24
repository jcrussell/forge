import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createHorizontalLayout,
} from "../mocks/helpers/index.js";

// Window minimum sizes come from Meta.Window.get_min_size(), Mutter 50+ (compat.md)
vi.mock("resource:///org/gnome/shell/misc/config.js", () => ({ PACKAGE_VERSION: "50.0" }));

/**
 * forge-awf4: on GNOME 45-48 Mutter drops a Wayland request that matches the
 * window's current frame, so an older request the app commits afterwards leaves
 * a tiled window off its tile. Its size-changed re-renders even when no tiled
 * window has focus or the focused window is maximized, so move() requests the
 * tile again.
 */
describe("forge-awf4: a tiled window that leaves its requested frame is rendered again", () => {
  let ctx;
  let first;
  let second;
  let renderTree;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
    vi.spyOn(ctx.windowManager, "updateBorderLayout").mockImplementation(() => {});
    vi.spyOn(ctx.windowManager, "updateDecorationLayout").mockImplementation(() => {});
    const { monitor } = getWorkspaceAndMonitor(ctx);
    [first, second] = createHorizontalLayout(ctx.tree, monitor, 2);
    second.metaWindow.move_resize_frame(true, 960, 0, 960, 1080);
    second.metaWindow._forgeRequestedRect = { x: 960, y: 0, width: 960, height: 1080 };
    renderTree = vi.spyOn(ctx.windowManager, "renderTree").mockImplementation(() => {});
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const commitOlderRequest = () => second.metaWindow.move_resize_frame(true, 640, 0, 1280, 1080);
  const sizeChanged = () =>
    ctx.windowManager.updateMetaPositionSize(second.metaWindow, "size-changed");

  it("with no focused window", () => {
    ctx.display.get_focus_window.mockReturnValue(null);
    commitOlderRequest();

    sizeChanged();

    expect(renderTree).toHaveBeenCalledWith("size-changed");
  });

  it("while the focused window is maximized", () => {
    first.metaWindow.maximize();
    ctx.display.get_focus_window.mockReturnValue(first.metaWindow);
    commitOlderRequest();

    sizeChanged();

    expect(renderTree).toHaveBeenCalledWith("size-changed");
  });

  it("not when the frame is the one requested", () => {
    ctx.display.get_focus_window.mockReturnValue(null);

    sizeChanged();

    expect(renderTree).not.toHaveBeenCalled();
  });

  it("not when the app holds the frame at its minimum size", () => {
    ctx.display.get_focus_window.mockReturnValue(null);
    second.metaWindow._forgeRequestedRect = { x: 960, y: 0, width: 400, height: 1080 };
    second.metaWindow.move_resize_frame(true, 960, 0, 500, 1080);
    second.metaWindow._size_hints = { min_width: 500, min_height: 100 };

    sizeChanged();

    expect(renderTree).not.toHaveBeenCalled();
  });
});
