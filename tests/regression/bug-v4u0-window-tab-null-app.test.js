import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-v4u0: _createWindowTab() must not dereference a null app.
 *
 * A WINDOW node's `app` is set from Shell.WindowTracker.get_window_app(), which can
 * return null. _createWindowTab() guarded only on `this.tab || !this.isWindow()`
 * before passing `this.app` to _buildTabBase() -> app.create_icon_texture(), so a
 * null app threw. The sibling _ensureConTab() already guards `!rep.app` and returns
 * early; this test pins the same tolerance for the window-tab path.
 *
 * The default Shell mock's WindowTracker.get_window_app() always returns an App, so
 * no existing test exercises the null path — we force `app = null` directly.
 */
describe("Bug forge-v4u0: _createWindowTab tolerates a null app", () => {
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

  it("does not throw and creates no tab when the window has no app", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const { nodeWindow } = createWindowNode(ctx.tree, monitor);

    // Simulate WindowTracker returning no app, then re-run tab creation. Clear the
    // tab built during construction so the icon-building path is actually reached.
    nodeWindow.tab = null;
    nodeWindow.app = null;

    expect(() => nodeWindow._createWindowTab()).not.toThrow();
    expect(nodeWindow.tab).toBeFalsy();

    // A tab-less window must still render (and stay a valid tiled window node).
    expect(() => nodeWindow.render()).not.toThrow();
    expect(nodeWindow.isWindow()).toBe(true);
  });
});
