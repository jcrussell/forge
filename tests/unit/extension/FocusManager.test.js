import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  setPointer,
} from "../../mocks/helpers/index.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { Rectangle, WindowType } from "../../mocks/gnome/Meta.js";
import { mockSeat } from "../../mocks/gnome/Clutter.js";

/**
 * Dedicated unit suite for lib/extension/focus.js (FocusManager).
 *
 * FocusManager's methods are reached through WindowManager (which delegates to
 * the shared instance) using the same createWindowManagerFixture() helper that
 * WindowManager-focus.test.js uses. This suite targets the guard branches of
 * _focusWindowUnderPointer() that the existing happy-path-only test leaves
 * uncovered, plus the _freezeRender no-op paths of the stacked/tabbed updaters.
 *
 * See forge-q7pa.
 */
describe("FocusManager", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    mockSeat.warp_pointer.mockClear();
    ctx.overview.visible = false;
    setPointer(480, 540);
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  afterEach(() => {
    if (wm()._pointerFocusTimeoutId) {
      vi.clearAllTimers();
    }
    ctx.cleanup();
  });

  /**
   * Place a focusable Meta window under the pointer so that, absent any guard,
   * _focusWindowUnderPointer() would call focus()+raise() on it. Returns spies
   * so guard tests can assert focus is NOT stolen.
   */
  const placeWindowUnderPointer = () => {
    const metaWindow = createMockWindow({
      rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
      workspace: workspace0(),
    });
    global.get_window_actors.mockReturnValue([{ meta_window: metaWindow }]);
    global.get_pointer.mockReturnValue([480, 540]);
    return {
      metaWindow,
      focusSpy: vi.spyOn(metaWindow, "focus"),
      raiseSpy: vi.spyOn(metaWindow, "raise"),
    };
  };

  describe("_focusWindowUnderPointer() - happy path", () => {
    it("focuses and raises the window under the pointer, returns true", () => {
      const { focusSpy, raiseSpy } = placeWindowUnderPointer();
      wm().shouldFocusOnHover = true;

      const result = wm()._focusWindowUnderPointer();

      expect(focusSpy).toHaveBeenCalledWith(12345);
      expect(raiseSpy).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe("_focusWindowUnderPointer() - disabling guards (return false)", () => {
    it("returns false and clears the timeout id when shouldFocusOnHover is false", () => {
      const { focusSpy, raiseSpy } = placeWindowUnderPointer();
      wm().shouldFocusOnHover = false;
      wm().disabled = false;
      wm()._pointerFocusTimeoutId = 99;

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(false);
      expect(wm()._pointerFocusTimeoutId).toBe(0);
      expect(focusSpy).not.toHaveBeenCalled();
      expect(raiseSpy).not.toHaveBeenCalled();
    });

    it("returns false and clears the timeout id when disabled is true", () => {
      const { focusSpy, raiseSpy } = placeWindowUnderPointer();
      wm().shouldFocusOnHover = true;
      wm().disabled = true;
      wm()._pointerFocusTimeoutId = 99;

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(false);
      expect(wm()._pointerFocusTimeoutId).toBe(0);
      expect(focusSpy).not.toHaveBeenCalled();
      expect(raiseSpy).not.toHaveBeenCalled();
    });
  });

  describe("_focusWindowUnderPointer() - continuing guards (return true, no focus)", () => {
    it("does not focus when tiling-only is set and tiling is disabled (#458)", () => {
      const { focusSpy, raiseSpy } = placeWindowUnderPointer();
      wm().shouldFocusOnHover = true;
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "focus-on-hover-tiling-only") return true;
        if (key === "tiling-mode-enabled") return false;
        return false;
      });

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(true);
      expect(focusSpy).not.toHaveBeenCalled();
      expect(raiseSpy).not.toHaveBeenCalled();
    });

    it("does not focus when the overview is visible", () => {
      const { focusSpy, raiseSpy } = placeWindowUnderPointer();
      wm().shouldFocusOnHover = true;
      ctx.overview.visible = true;

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(true);
      expect(focusSpy).not.toHaveBeenCalled();
      expect(raiseSpy).not.toHaveBeenCalled();
    });

    it("does not focus during a workspace transition (#374)", () => {
      const { focusSpy, raiseSpy } = placeWindowUnderPointer();
      wm().shouldFocusOnHover = true;
      wm()._workspaceChanging = true;

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(true);
      expect(focusSpy).not.toHaveBeenCalled();
      expect(raiseSpy).not.toHaveBeenCalled();
    });

    it("does not steal focus from a MODAL_DIALOG (#483)", () => {
      const { focusSpy, raiseSpy } = placeWindowUnderPointer();
      wm().shouldFocusOnHover = true;
      ctx.display.focus_window = createMockWindow({ window_type: WindowType.MODAL_DIALOG });

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(true);
      expect(focusSpy).not.toHaveBeenCalled();
      expect(raiseSpy).not.toHaveBeenCalled();
    });

    it("does not steal focus from a DIALOG (#483)", () => {
      const { focusSpy, raiseSpy } = placeWindowUnderPointer();
      wm().shouldFocusOnHover = true;
      ctx.display.focus_window = createMockWindow({ window_type: WindowType.DIALOG });

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(true);
      expect(focusSpy).not.toHaveBeenCalled();
      expect(raiseSpy).not.toHaveBeenCalled();
    });

    it("still focuses when the focused window is a NORMAL window (#483 regression)", () => {
      const { focusSpy, raiseSpy } = placeWindowUnderPointer();
      wm().shouldFocusOnHover = true;
      ctx.display.focus_window = createMockWindow({ window_type: WindowType.NORMAL });

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(true);
      expect(focusSpy).toHaveBeenCalled();
      expect(raiseSpy).toHaveBeenCalled();
    });
  });

  describe("updateStackedFocus() / updateTabbedFocus() - _freezeRender no-op", () => {
    const stackedNode = (layout) => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, null);
      container.layout = layout;
      container.rect = { x: 0, y: 0, width: 960, height: 1080 };
      const { nodeWindow } = createWindowNode(ctx.tree, container, {
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
          workspace: workspace0(),
        },
      });
      return nodeWindow;
    };

    it("updateStackedFocus is a no-op when _freezeRender is true", () => {
      const nodeWindow = stackedNode(LAYOUT_TYPES.STACKED);
      const raiseSpy = vi.spyOn(nodeWindow.nodeValue, "raise");
      const queueSpy = vi.spyOn(wm(), "queueEvent");
      wm()._freezeRender = true;

      wm().updateStackedFocus(nodeWindow);

      expect(raiseSpy).not.toHaveBeenCalled();
      expect(queueSpy).not.toHaveBeenCalled();
    });

    it("updateTabbedFocus is a no-op when _freezeRender is true", () => {
      const nodeWindow = stackedNode(LAYOUT_TYPES.TABBED);
      const raiseSpy = vi.spyOn(nodeWindow.nodeValue, "raise");
      wm()._freezeRender = true;

      wm().updateTabbedFocus(nodeWindow);

      expect(raiseSpy).not.toHaveBeenCalled();
    });
  });
});
