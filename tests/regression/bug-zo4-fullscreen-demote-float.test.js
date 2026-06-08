import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WindowType } from "../mocks/gnome/Meta.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-zo4 (#460): always-on-top floats render over a fullscreen window.
 *
 * When a window goes fullscreen, Forge-pinned always-on-top FLOAT windows on
 * the SAME monitor used to keep rendering above the fullscreen surface. The
 * in-fullscreen-changed signal only re-rendered; nothing demoted the floats.
 *
 * Fix: _reconcileFullscreenFloatDemotion() unmake_above()'s Forge-pinned floats
 * on a monitor that has a (non-dialog) fullscreen window, tagging them with a
 * transient _aboveDemotedForFullscreen flag, and re-pins them once that monitor
 * has no fullscreen window left. Dialogs/transients and user-pinned floats are
 * never touched.
 */
describe("forge-zo4: demote always-on-top floats under a fullscreen window", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 2 } },
      settings: { "float-always-on-top-enabled": true },
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // Create a window node under the given monitor with an explicit mode.
  function addWindow(monitor, { mode = WINDOW_MODES.TILE, forgeAbove = false, ...overrides } = {}) {
    const win = createMockWindow({ wm_class: "App", ...overrides });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = mode;
    if (forgeAbove) {
      win.make_above();
      node._forgeSetAbove = true;
    }
    return { win, node };
  }

  it("demotes a Forge-pinned float when another window goes fullscreen", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const float = addWindow(monitor, { mode: WINDOW_MODES.FLOAT, forgeAbove: true });
    const { win: other } = addWindow(monitor);

    other.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();

    expect(float.win.is_above()).toBe(false);
    expect(float.node._aboveDemotedForFullscreen).toBe(true);
    // The pin intent is preserved so the float can be restored.
    expect(float.node._forgeSetAbove).toBe(true);
  });

  it("lowers the demoted float so it drops below the fullscreen window", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const float = addWindow(monitor, { mode: WINDOW_MODES.FLOAT, forgeAbove: true });
    const { win: other } = addWindow(monitor);
    const lowerSpy = vi.spyOn(float.win, "lower");

    other.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();

    // unmake_above() alone does not restack below fullscreen (see e2e); lower() does.
    expect(lowerSpy).toHaveBeenCalled();
  });

  it("restores the float when the fullscreen window exits fullscreen", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const float = addWindow(monitor, { mode: WINDOW_MODES.FLOAT, forgeAbove: true });
    const { win: other } = addWindow(monitor);

    other.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();
    other.unmake_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();

    expect(float.win.is_above()).toBe(true);
    expect(float.node._aboveDemotedForFullscreen).toBeFalsy();
  });

  it("keeps the float demoted until the LAST fullscreen window exits (refcount)", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const float = addWindow(monitor, { mode: WINDOW_MODES.FLOAT, forgeAbove: true });
    const { win: fsA } = addWindow(monitor);
    const { win: fsB } = addWindow(monitor);

    fsA.make_fullscreen();
    fsB.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();
    expect(float.win.is_above()).toBe(false);

    fsA.unmake_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();
    expect(float.win.is_above()).toBe(false); // still one fullscreen window

    fsB.unmake_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();
    expect(float.win.is_above()).toBe(true);
  });

  it("never demotes a dialog/transient float", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const dialog = addWindow(monitor, {
      mode: WINDOW_MODES.FLOAT,
      forgeAbove: true,
      window_type: WindowType.DIALOG,
    });
    const { win: other } = addWindow(monitor);

    other.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();

    expect(dialog.win.is_above()).toBe(true);
    expect(dialog.node._aboveDemotedForFullscreen).toBeFalsy();
  });

  it("does not clobber a user-pinned float (no _forgeSetAbove)", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const userFloat = addWindow(monitor, { mode: WINDOW_MODES.FLOAT });
    userFloat.win.make_above(); // user pin, Forge did not set it
    const { win: other } = addWindow(monitor);

    other.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();

    expect(userFloat.win.is_above()).toBe(true);
    expect(userFloat.node._aboveDemotedForFullscreen).toBeFalsy();
  });

  it("only demotes floats on the monitor with the fullscreen window", () => {
    const { monitor: mon0 } = getWorkspaceAndMonitor(ctx, 0, 0);
    const { monitor: mon1 } = getWorkspaceAndMonitor(ctx, 0, 1);
    const float0 = addWindow(mon0, { mode: WINDOW_MODES.FLOAT, forgeAbove: true });
    const { win: fsOnMon1 } = addWindow(mon1);

    fsOnMon1.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();

    // Float on monitor 0 is untouched; the fullscreen is on monitor 1.
    expect(float0.win.is_above()).toBe(true);
    expect(float0.node._aboveDemotedForFullscreen).toBeFalsy();
  });

  it("a float that itself goes fullscreen is not demoted by its own count", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const float = addWindow(monitor, { mode: WINDOW_MODES.FLOAT, forgeAbove: true });

    float.win.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();

    expect(float.win.is_above()).toBe(true);
    expect(float.node._aboveDemotedForFullscreen).toBeFalsy();
  });

  it("restores demoted floats when the fullscreen window is destroyed", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const float = addWindow(monitor, { mode: WINDOW_MODES.FLOAT, forgeAbove: true });
    const fs = addWindow(monitor);

    fs.win.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();
    expect(float.win.is_above()).toBe(false);

    ctx.windowManager.windowDestroy(fs.node.actor);

    expect(float.win.is_above()).toBe(true);
    expect(float.node._aboveDemotedForFullscreen).toBeFalsy();
  });

  it("restores all demoted floats on disable()", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const float = addWindow(monitor, { mode: WINDOW_MODES.FLOAT, forgeAbove: true });
    const { win: other } = addWindow(monitor);

    other.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();
    expect(float.win.is_above()).toBe(false);

    ctx.windowManager.disable();

    expect(float.win.is_above()).toBe(true);
    expect(float.node._aboveDemotedForFullscreen).toBeFalsy();
  });

  it("suppresses _handleUserAboveChange while it toggles above itself", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const float = addWindow(monitor, { mode: WINDOW_MODES.FLOAT, forgeAbove: true });
    const { win: other } = addWindow(monitor);
    // Wire the per-window signal exactly as trackWindow does.
    float.win.connect("notify::above", (w) => ctx.windowManager._handleUserAboveChange(w));
    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree");

    other.make_fullscreen();
    ctx.windowManager._reconcileFullscreenFloatDemotion();

    // Forge's own unmake_above must not be mistaken for a user toggle.
    expect(renderSpy).not.toHaveBeenCalledWith("notify-above");
  });
});
