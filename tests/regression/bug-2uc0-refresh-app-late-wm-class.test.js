import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Shell from "../mocks/gnome/Shell.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-2uc0: a window whose Shell.WindowTracker app is null at map time
 * never gets a tab.
 *
 * Node.app is snapshotted once in _initMetaWindow() at construction, and
 * _createWindowTab() bails on !this.app (forge-v4u0). Apps that report wm_class
 * late (Anki, Opera, many Flatpaks) have a null app then, so they tile but never
 * gain a tab — the notify::wm-class handler only called renderTree, never
 * re-initialised the app. Node.refreshApp() re-runs the snapshot and (re)builds
 * the tab; _createWindowTab early-returns once this.tab exists so it only fills
 * the gap left by the earlier null app.
 */
describe("Bug forge-2uc0: Node.refreshApp rebuilds app + tab when wm_class lands", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("creates the missing tab after the app resolves", () => {
    // App is null at map time (late wm_class apps).
    const spy = vi.spyOn(Shell.WindowTracker.prototype, "get_window_app").mockReturnValue(null);

    const { monitor } = getWorkspaceAndMonitor(ctx);
    const { nodeWindow } = createWindowNode(ctx.tree, monitor);

    // No app -> no tab, but the node is still a valid tiled window.
    expect(nodeWindow.app).toBeNull();
    expect(nodeWindow.tab).toBeFalsy();

    // wm_class lands: the tracker now resolves an app.
    const app = { get_name: () => "Late App", create_icon_texture: () => ({}) };
    spy.mockReturnValue(app);

    nodeWindow.refreshApp();

    expect(nodeWindow.app).toBe(app);
    expect(nodeWindow.tab).toBeTruthy();
  });
});
