import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";

/**
 * forge-ipga: two keybinding paths dereferenced the focus window without a
 * guard and threw when nothing (or an untracked window) was focused:
 *  - the FloatToggle/FloatClassToggle command case crashed in
 *    Utils.resolveRect(_, null) with no focus, and on
 *    `focusNodeWindow.parentNode` with a focused-but-untracked window —
 *    unlike Swap/Split/LayoutToggle, which all guard.
 *  - WindowManager.resize() called `metaWindow.get_frame_rect()` on null;
 *    all six resize/expand/shrink actions dispatch into it unconditionally.
 *
 * Fix: early-return guards (focusNodeWindow in the float case, metaWindow in
 * resize), matching the other command cases.
 */
describe("forge-ipga: float/resize keybindings with no tracked focus window", () => {
  // Same shape the real keybindings dispatch (DEFAULT_FLOAT_LAYOUT).
  const FLOAT_ACTION = { mode: "float", x: "center", y: "center", width: 0.65, height: 0.75 };

  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("FloatToggle with no focused window does not throw", () => {
    expect(ctx.display.get_focus_window()).toBeNull();
    expect(() => ctx.windowManager.command({ name: "FloatToggle", ...FLOAT_ACTION })).not.toThrow();
  });

  it("FloatToggle with a focused but untracked window does not throw", () => {
    const untracked = createMockWindow({ wm_class: "UntrackedApp" });
    ctx.display.get_focus_window.mockReturnValue(untracked);

    expect(() => ctx.windowManager.command({ name: "FloatToggle", ...FLOAT_ACTION })).not.toThrow();
  });

  it("FloatToggle still reaches toggleFloatingMode for a tracked window", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const win = createMockWindow({ wm_class: "App" });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    ctx.display.get_focus_window.mockReturnValue(win);

    const toggleSpy = vi.spyOn(ctx.windowManager, "toggleFloatingMode");
    ctx.windowManager.command({ name: "FloatToggle", ...FLOAT_ACTION });
    expect(toggleSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "FloatToggle" }), win);
  });

  it.each([
    "WindowResizeRight",
    "WindowResizeLeft",
    "WindowResizeTop",
    "WindowResizeBottom",
    "WindowExpand",
    "WindowShrink",
  ])("%s with no focused window does not throw", (name) => {
    expect(ctx.display.get_focus_window()).toBeNull();
    expect(() => ctx.windowManager.command({ name, amount: 10 })).not.toThrow();
  });
});
