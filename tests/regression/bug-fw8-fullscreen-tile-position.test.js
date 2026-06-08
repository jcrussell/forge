import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createHorizontalLayout,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-fw8 (gh-509): a fullscreen video shifts right / crops when a second
 * app is open.
 *
 * A window kept in the tree as TILE stays TILE while fullscreen. When
 * `in-fullscreen-changed` fires, renderTree -> tree.apply() moves EVERY tiled
 * window to its computed split `renderRect` (tree.js apply). With a sibling, the
 * fullscreen window's split slice is offset+cropped, so Forge re-positions the
 * fullscreen surface over Mutter's full-monitor geometry.
 *
 * A second path: handleMaximizeOnSingle() maximizes a lone tiled window when it
 * is "not maximized" — a lone *fullscreen* window is not maximized, so it gets
 * force-maximized, fighting fullscreen.
 *
 * Fix: tree.apply() excludes fullscreen windows from the slice-application list,
 * and handleMaximizeOnSingle() skips a fullscreen sole window.
 */
describe("Bug forge-fw8: fullscreen tiled window is not re-sliced", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true },
    });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const wm = () => ctx.windowManager;

  it("apply() does not move a fullscreen window to its split slice, but lays out siblings", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const [first, second] = createHorizontalLayout(ctx.tree, monitor, 2);

    // Each pane's computed split slice (half a 1920x1080 monitor).
    first.nodeWindow.renderRect = { x: 0, y: 0, width: 960, height: 1080 };
    second.nodeWindow.renderRect = { x: 960, y: 0, width: 960, height: 1080 };

    first.metaWindow.make_fullscreen();

    const moveSpy = vi.spyOn(wm(), "move").mockImplementation(() => {});

    ctx.tree.apply(ctx.tree);

    const movedWindows = moveSpy.mock.calls.map((c) => c[0]);
    // The fullscreen window must NOT be re-sliced...
    expect(movedWindows).not.toContain(first.metaWindow);
    // ...while its non-fullscreen sibling is still laid out into its slice.
    expect(moveSpy).toHaveBeenCalledWith(second.metaWindow, second.nodeWindow.renderRect);
  });

  it("apply() still moves a normal (non-fullscreen) tiled window to its slice", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const [first, second] = createHorizontalLayout(ctx.tree, monitor, 2);
    first.nodeWindow.renderRect = { x: 0, y: 0, width: 960, height: 1080 };
    second.nodeWindow.renderRect = { x: 960, y: 0, width: 960, height: 1080 };

    const moveSpy = vi.spyOn(wm(), "move").mockImplementation(() => {});

    ctx.tree.apply(ctx.tree);

    expect(moveSpy).toHaveBeenCalledWith(first.metaWindow, first.nodeWindow.renderRect);
    expect(moveSpy).toHaveBeenCalledWith(second.metaWindow, second.nodeWindow.renderRect);
  });

  it("handleMaximizeOnSingle() leaves a sole fullscreen window unmaximized", () => {
    ctx.settings.set_boolean("window-maximize-on-single", true);

    const { monitor } = getWorkspaceAndMonitor(ctx);
    const [only] = createHorizontalLayout(ctx.tree, monitor, 1);
    only.metaWindow.make_fullscreen();

    wm().handleMaximizeOnSingle();

    expect(only.metaWindow.is_maximized()).toBe(false);
  });

  it("handleMaximizeOnSingle() still maximizes a sole non-fullscreen window", () => {
    ctx.settings.set_boolean("window-maximize-on-single", true);

    const { monitor } = getWorkspaceAndMonitor(ctx);
    const [only] = createHorizontalLayout(ctx.tree, monitor, 1);

    wm().handleMaximizeOnSingle();

    expect(only.metaWindow.is_maximized()).toBe(true);
  });
});
