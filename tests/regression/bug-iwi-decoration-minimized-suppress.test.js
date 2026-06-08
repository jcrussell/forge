import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-iwi (gh-303): tab/stack decorations randomly vanish.
 *
 * updateDecorationLayout() suppresses tab/stack decorations on any monitor that
 * has a maximized OR fullscreen window. The suppression filter counted MINIMIZED
 * windows too, so a window that was maximized and then minimized (covering
 * nothing) kept every tabbed/stacked decoration on that monitor hidden until it
 * was closed or unmaximized — the "decoration disappeared" report.
 *
 * Fix: exclude minimized windows from the suppression filter (reusing the same
 * `!minimized` predicate getTiledChildren/_tiledWindowsOnMonitor already use).
 */
describe("Bug forge-iwi: minimized maximized window must not suppress decorations", () => {
  let ctx;
  let con;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });

    // A tabbed container with two visible tiled windows (so a non-minimized
    // window remains and the "all hidden" early-return is not tripped).
    const { monitor } = getWorkspaceAndMonitor(ctx);
    con = createContainerNode(monitor, LAYOUT_TYPES.TABBED);
    con.decoration = { show: vi.fn(), hide: vi.fn() };
    createWindowNode(ctx.tree, con, { windowOverrides: { id: "tab-a" } });
    createWindowNode(ctx.tree, con, { windowOverrides: { id: "tab-b" } });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  // Add a third window on the same monitor in the given state.
  function addOther({ maximize = false, fullscreen = false, minimized = false } = {}) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const { metaWindow } = createWindowNode(ctx.tree, monitor, {
      windowOverrides: { id: "other" },
    });
    if (maximize) metaWindow.maximize();
    if (fullscreen) metaWindow.make_fullscreen();
    if (minimized) metaWindow.minimized = true;
    return metaWindow;
  }

  it("shows tab decorations when the maximized window is minimized", () => {
    addOther({ maximize: true, minimized: true });

    ctx.windowManager.updateDecorationLayout();

    expect(con.decoration.show).toHaveBeenCalled();
  });

  it("shows tab decorations when the fullscreen window is minimized", () => {
    addOther({ fullscreen: true, minimized: true });

    ctx.windowManager.updateDecorationLayout();

    expect(con.decoration.show).toHaveBeenCalled();
  });

  it("still suppresses decorations for a visible (non-minimized) maximized window", () => {
    addOther({ maximize: true, minimized: false });

    ctx.windowManager.updateDecorationLayout();

    expect(con.decoration.show).not.toHaveBeenCalled();
  });
});
