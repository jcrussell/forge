import { describe, it, expect, afterEach } from "vitest";
import { NODE_TYPES, POSITION, ORIENTATION_TYPES } from "../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createMockWindow,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-fhen.4 (Half B): a real Meta.Window can transiently report no
 * workspace — get_workspace() returns null during creation, on a Wayland
 * map/unmap race, or as a workspace is being removed. Three call sites
 * dereferenced get_workspace().index() / .activate_with_focus() with no null
 * guard, so an unplaced window crashed the path (and, from a raw signal handler,
 * the whole reconcile). The lenient base mock hid this by never returning null
 * unless a test asked for it; these tests ask (workspace: null) and pin the guard.
 */
describe("Bug forge-fhen.4: null get_workspace() derefs are guarded", () => {
  let ctx;

  afterEach(() => ctx?.cleanup());

  it("trackCurrentMonWs does not throw when the focus window has no workspace", () => {
    ctx = createWindowManagerFixture();
    const win = createMockWindow({ id: 9401, monitor: 0, workspace: null });
    ctx.display.get_focus_window.mockReturnValue(win);

    expect(() => ctx.windowManager.trackCurrentMonWs()).not.toThrow();
  });

  it("nextMonitor does not throw when the window has no workspace", () => {
    // Two vertically-stacked monitors so the geometry fallback resolves a real
    // neighbor (targetMonitor >= 0), reaching the get_workspace().index() deref.
    ctx = createWindowManagerFixture({
      globals: {
        display: {
          monitorCount: 2,
          monitorGeometries: [
            { x: 0, y: 0, width: 1920, height: 1080 },
            { x: 0, y: 1080, width: 1920, height: 1080 },
          ],
        },
      },
    });
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const win = createMockWindow({ id: 9402, monitor: 0, workspace: null });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);

    let result;
    expect(() => {
      result = ctx.tree.nextMonitor(node, POSITION.AFTER, ORIENTATION_TYPES.VERTICAL);
    }).not.toThrow();
    // No workspace means no monitor-workspace node to resolve.
    expect(result).toBe(null);
  });

  it("postProcessWindow does not throw when the prefs window has no workspace", () => {
    ctx = createWindowManagerFixture();
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const win = createMockWindow({
      id: 9403,
      monitor: 0,
      workspace: null,
      title: "PREFS-WINDOW-MATCH",
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    // Force the prefs-window branch that activates the (missing) workspace.
    ctx.windowManager.prefsTitle = "PREFS-WINDOW-MATCH";

    expect(() => ctx.windowManager.postProcessWindow(node)).not.toThrow();
  });
});
