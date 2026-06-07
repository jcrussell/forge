import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug #469 (forge-w7e): GNOME "Always on Top" breaks tiling.
 *
 * "Always on Top" is a Z-axis stacking pin (make_above). A pinned tiled window
 * used to stay in the tile flow yet render above its siblings, desyncing the
 * layout. Forge only ever pins windows it already floats, so treating any
 * above window as floating-exempt is both correct and minimal; a notify::above
 * handler triggers a re-render so the change takes effect immediately.
 */
describe("Bug #469: user Always-on-Top floats out of the tree", () => {
  let ctx;
  let win1;
  let win2;
  let node1;
  let node2;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    win1 = createMockWindow({ wm_class: "App1", id: 1001, title: "One", allows_resize: true });
    win2 = createMockWindow({ wm_class: "App2", id: 1002, title: "Two", allows_resize: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win1);
    node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win2);
    node1.mode = WINDOW_MODES.TILE;
    node2.mode = WINDOW_MODES.TILE;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("treats an Always-on-Top window as floating-exempt", () => {
    expect(ctx.windowManager.isFloatingExempt(win1)).toBe(false);

    win1.make_above();
    expect(ctx.windowManager.isFloatingExempt(win1)).toBe(true);

    win1.unmake_above();
    expect(ctx.windowManager.isFloatingExempt(win1)).toBe(false);
  });

  it("floats a pinned window out of the tree and retiles it when unpinned", () => {
    ctx.windowManager.processFloats();
    expect(node1.isTile()).toBe(true);

    win1.make_above();
    ctx.windowManager.processFloats();
    expect(node1.isFloat()).toBe(true);
    // The sibling is unaffected.
    expect(node2.isTile()).toBe(true);

    win1.unmake_above();
    ctx.windowManager.processFloats();
    expect(node1.isTile()).toBe(true);
  });

  it("re-renders when a window's above state toggles (signal wiring)", () => {
    // Mirror the per-window wiring from trackWindow to prove the signal name.
    win1.connect("notify::above", (w) => ctx.windowManager._handleUserAboveChange(w));
    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree");

    win1.make_above();
    expect(renderSpy).toHaveBeenCalled();
  });
});
