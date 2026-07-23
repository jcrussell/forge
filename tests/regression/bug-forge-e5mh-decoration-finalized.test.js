import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-e5mh (audit-2026-07 / C15): updateDecorationLayout() calls
 * showing_on_its_workspace()/minimized and Compat.isMaximized/is_fullscreen on
 * every WINDOW node's nodeValue with no Utils.isWindowAlive. It is invoked pre-prune
 * from showing-desktop-changed, active-workspace-changed, workspace-removed, etc.,
 * so a finalized wrapper throws — aborting the handler, so the subsequent
 * renderTree never runs (tab/stack title bars vanish).
 *
 * Fix: drop dead windows before the filters.
 */
describe("Bug forge-e5mh: updateDecorationLayout skips finalized windows", () => {
  let ctx;
  const boom = () => {
    throw new Error("Object .Meta.Window has been already deallocated");
  };

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("does not throw and still lays out decorations when a wrapper is finalized", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    // A tabbed container with two live tiled windows (so decorations should show).
    const con = createContainerNode(monitor, LAYOUT_TYPES.TABBED);
    con.decoration = { show: vi.fn(), hide: vi.fn() };
    createWindowNode(ctx.tree, con, { windowOverrides: { id: "tab-a" } });
    createWindowNode(ctx.tree, con, { windowOverrides: { id: "tab-b" } });

    // A window that closed mid-relayout: its wrapper is finalized.
    const dead = createMockWindow({ id: 9501, workspace: ctx.workspaces[0] });
    dead.get_id = boom;
    dead.showing_on_its_workspace = boom;
    dead.is_fullscreen = boom;
    Object.defineProperty(dead, "minimized", { configurable: true, get: boom });
    const deadNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dead);
    deadNode.mode = WINDOW_MODES.TILE;

    expect(() => ctx.windowManager.updateDecorationLayout()).not.toThrow();
    expect(con.decoration.show).toHaveBeenCalled();
  });
});
