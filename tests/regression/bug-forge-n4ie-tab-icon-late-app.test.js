import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Shell from "../mocks/gnome/Shell.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-n4ie: when a window's app resolves late (the forge-3qq set: Anki,
 * Opera, many Flatpaks), refreshApp re-read the app but _createWindowTab
 * returned early because the tab already existed, so a tab built from an earlier
 * (window-backed fallback) app kept its icon. _ensureConTab only rebuilt a CON
 * header tab when the representative WINDOW changed, not its app.
 *
 * Fix: both swap the tab icon when the app it was built from has changed. The
 * null-app-at-map-time case (no tab until the app resolves) is forge-2uc0.
 */
describe("Bug forge-n4ie: tab icons follow an app that resolves late", () => {
  let ctx;
  let trackerSpy;

  const app = (name) => {
    const icon = { name };
    return { get_name: () => name, create_icon_texture: vi.fn(() => icon), icon };
  };
  const tabIcon = (node) => node.tab.get_child_at_index(0).child;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
    trackerSpy = vi.spyOn(Shell.WindowTracker.prototype, "get_window_app");
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("refreshApp gives an existing window tab the resolved app's icon", () => {
    const fallback = app("fallback");
    const real = app("Real");
    trackerSpy.mockReturnValue(fallback);
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const { nodeWindow } = createWindowNode(ctx.tree, monitor);
    const tab = nodeWindow.tab;
    expect(tabIcon(nodeWindow)).toBe(fallback.icon);

    trackerSpy.mockReturnValue(real);
    nodeWindow.refreshApp();

    expect(nodeWindow.tab).toBe(tab);
    expect(tabIcon(nodeWindow)).toBe(real.icon);
  });

  it("_ensureConTab gives a CON header tab the representative's new app icon", () => {
    const fallback = app("fallback");
    const real = app("Real");
    trackerSpy.mockReturnValue(fallback);
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const tabbed = createContainerNode(monitor, LAYOUT_TYPES.TABBED);
    const con = createContainerNode(tabbed, LAYOUT_TYPES.HSPLIT);
    const { nodeWindow: rep } = createWindowNode(ctx.tree, con);
    con._ensureConTab();
    expect(tabIcon(con)).toBe(fallback.icon);

    trackerSpy.mockReturnValue(real);
    rep.refreshApp();
    con._ensureConTab();

    expect(con.getNodeByType(NODE_TYPES.WINDOW)[0]).toBe(rep);
    expect(tabIcon(con)).toBe(real.icon);
  });

  it("keeps the icon when the app is unchanged or resolves to null", () => {
    const real = app("Real");
    trackerSpy.mockReturnValue(real);
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const { nodeWindow } = createWindowNode(ctx.tree, monitor);

    nodeWindow.refreshApp();
    trackerSpy.mockReturnValue(null);
    nodeWindow.refreshApp();

    expect(real.create_icon_texture).toHaveBeenCalledTimes(1);
    expect(tabIcon(nodeWindow)).toBe(real.icon);
  });
});
