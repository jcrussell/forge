import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug #482 (forge-3qq): apps with a late/null wm_class never auto-tile.
 *
 * Anki, Opera, and many Flatpak apps report a null wm_class at map time. The
 * `get_wm_class() === null` clause in isFloatingExempt floats them, and because
 * no signal re-evaluates the decision once the class lands, they stay floated
 * forever (also explains the stuck-floating reports in #387/#453/#219).
 *
 * Fix: a notify::wm-class handler in trackWindow re-renders, so processFloats
 * re-evaluates and tiles the window once its class is known.
 */
describe("Bug #482: late wm_class re-tiles", () => {
  let ctx;
  let win;
  let node;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    // A real Anki window: NORMAL, resizable, with a title — but no wm_class yet.
    win = createMockWindow({
      wm_class: null,
      id: 2001,
      title: "Anki",
      allows_resize: true,
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("floats a window while its wm_class is null", () => {
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(true);
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);
  });

  it("re-tiles the window once wm_class arrives", () => {
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);

    // The class lands late. Once known, the window is no longer floating-exempt.
    win.set_wm_class("Anki");
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(false);

    ctx.windowManager.processFloats();
    expect(node.isTile()).toBe(true);
  });

  it("wires notify::wm-class in trackWindow so a late class re-renders", () => {
    // End-to-end: trackWindow must connect the signal itself. Before the fix
    // there is no notify::wm-class handler, so the late class is never noticed.
    const tracked = createMockWindow({
      wm_class: null,
      id: 2002,
      title: "Opera",
      allows_resize: true,
    });
    ctx.windowManager.trackWindow(null, tracked);

    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree");
    tracked.set_wm_class("Opera");

    expect(renderSpy).toHaveBeenCalledWith("wm-class-changed");
  });
});
