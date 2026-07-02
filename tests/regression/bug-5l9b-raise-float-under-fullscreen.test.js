import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-5l9b (CI e2e on cc27b2d, F39/GNOME 45): the "focus" handler queues a
 * raise-float event that fires ~220ms later (queueEvent timeout). When it
 * landed after _reconcileFullscreenFloatDemotion() had demoted the focused
 * float (unmake_above + lower), fw.raise() restacked the float back over the
 * fullscreen window WITHOUT setting is_above() — so the reconcile on the next
 * render (which only demotes is_above() floats) never re-lowered it, and the
 * float stayed over the fullscreen surface. Same hole in the untiled-workspace
 * rehome path's float raise.
 *
 * Fix: both raise sites skip a float whose node carries
 * _aboveDemotedForFullscreen.
 */
describe("forge-5l9b: queued raise-float must not undo the fullscreen demotion", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "float-always-on-top-enabled": true },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  // Track a window through the real pipeline (so "focus" signal handlers are
  // bound), then convert it into a Forge-pinned always-on-top float.
  function trackFloat() {
    const win = createMockWindow({ wm_class: "FloatApp", workspace: ctx.workspaces[0] });
    wm().trackWindow(null, win);
    const node = wm().tree.findNode(win);
    node.mode = WINDOW_MODES.FLOAT;
    win.make_above();
    node._forgeSetAbove = true;
    return { win, node };
  }

  // Capture the queued "raise-float" callback fired by the "focus" signal
  // (GLib timeouts don't run in tests, so we invoke it directly — same
  // pattern as bug-d5mm-focus-restack).
  function fireFocusAndGetRaiseFloat(metaWindow) {
    const captured = [];
    vi.spyOn(wm(), "queueEvent").mockImplementation((eventObj) => captured.push(eventObj));
    ctx.display.get_focus_window.mockReturnValue(metaWindow);
    metaWindow.emit("focus", metaWindow);
    const raiseFloat = captured.find((e) => e.name === "raise-float");
    expect(raiseFloat).toBeDefined();
    vi.mocked(wm().queueEvent).mockRestore();
    return raiseFloat.callback;
  }

  it("skips raise() for a float demoted under a fullscreen window", () => {
    const float = trackFloat();
    const other = createMockWindow({ wm_class: "App", workspace: ctx.workspaces[0] });
    wm().trackWindow(null, other);

    // Focus the float; the raise-float event is queued but has not fired yet.
    const raiseFloatCallback = fireFocusAndGetRaiseFloat(float.win);

    // The fullscreen demotion lands before the queued event runs.
    other.make_fullscreen();
    wm()._reconcileFullscreenFloatDemotion();
    expect(float.win.is_above()).toBe(false);
    expect(float.node._aboveDemotedForFullscreen).toBe(true);

    const raiseSpy = vi.spyOn(float.win, "raise");
    raiseFloatCallback();

    expect(raiseSpy).not.toHaveBeenCalled();
  });

  it("still raises a focused float when it is not demoted", () => {
    const float = trackFloat();

    const raiseFloatCallback = fireFocusAndGetRaiseFloat(float.win);

    const raiseSpy = vi.spyOn(float.win, "raise");
    raiseFloatCallback();

    expect(raiseSpy).toHaveBeenCalled();
  });

  it("raises again once the fullscreen window exits and the float is restored", () => {
    const float = trackFloat();
    const other = createMockWindow({ wm_class: "App", workspace: ctx.workspaces[0] });
    wm().trackWindow(null, other);

    other.make_fullscreen();
    wm()._reconcileFullscreenFloatDemotion();
    other.unmake_fullscreen();
    wm()._reconcileFullscreenFloatDemotion();
    expect(float.node._aboveDemotedForFullscreen).toBeFalsy();

    const raiseFloatCallback = fireFocusAndGetRaiseFloat(float.win);
    const raiseSpy = vi.spyOn(float.win, "raise");
    raiseFloatCallback();

    expect(raiseSpy).toHaveBeenCalled();
  });
});
