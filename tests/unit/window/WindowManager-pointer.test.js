import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow, createWindowManagerFixture } from "../../mocks/helpers/index.js";
import { Rectangle, WindowType } from "../../mocks/gnome/Meta.js";
import { mockSeat } from "../../mocks/gnome/Clutter.js";

/**
 * WindowManager focus-follows-pointer tests
 *
 * Tests for pointer-related behaviors including:
 * - movePointerWith(): Warp pointer to focused window
 * - _focusWindowUnderPointer(): Focus window under pointer
 * - Focus disabled during overview
 * - Focus disabled during workspace transitions
 * - Dialog/modal focus protection
 */
describe("WindowManager - Focus-Follows-Pointer Behavior", () => {
  let ctx;

  beforeEach(() => {
    mockSeat.warp_pointer.mockClear();
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  describe("movePointerWith", () => {
    it("should return early when nodeWindow is null", () => {
      expect(() => wm().movePointerWith(null)).not.toThrow();
    });

    it("should return early when nodeWindow has no _data", () => {
      expect(() => wm().movePointerWith({})).not.toThrow();
    });

    it("should not warp pointer when move-pointer-focus-enabled is false", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "move-pointer-focus-enabled") return false;
        return true;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const warpSpy = vi.spyOn(wm(), "warpPointerToNodeWindow");

      wm().movePointerWith(nodeWindow);

      expect(warpSpy).not.toHaveBeenCalled();
    });

    it("should warp pointer when move-pointer-focus-enabled is true", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "move-pointer-focus-enabled") return true;
        return true;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const canMoveSpy = vi.spyOn(wm(), "canMovePointerInsideNodeWindow");

      wm().movePointerWith(nodeWindow);

      expect(canMoveSpy).toHaveBeenCalledWith(nodeWindow);
    });

    it("should warp pointer when force option is true", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "move-pointer-focus-enabled") return false;
        return true;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const canMoveSpy = vi.spyOn(wm(), "canMovePointerInsideNodeWindow");

      wm().movePointerWith(nodeWindow, { force: true });

      expect(canMoveSpy).toHaveBeenCalledWith(nodeWindow);
    });

    it("should update lastFocusedWindow", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      wm().movePointerWith(nodeWindow);

      expect(wm().lastFocusedWindow).toBe(nodeWindow);
    });
  });

  describe("_focusWindowUnderPointer - Focus Behavior", () => {
    it("should focus window under pointer when conditions are met", () => {
      wm().shouldFocusOnHover = true;
      wm().disabled = false;
      global.Main.overview.visible = false;

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const windowActor = metaWindow.get_compositor_private();
      windowActor.meta_window = metaWindow;
      global.get_window_actors.mockReturnValue([windowActor]);

      // Pointer is inside window
      global.get_pointer.mockReturnValue([960, 540]);

      const focusSpy = vi.spyOn(metaWindow, "focus");
      const raiseSpy = vi.spyOn(metaWindow, "raise");

      wm()._focusWindowUnderPointer();

      expect(focusSpy).toHaveBeenCalledWith(12345);
      expect(raiseSpy).toHaveBeenCalled();
    });

    it("should continue polling by returning true", () => {
      wm().shouldFocusOnHover = true;
      wm().disabled = false;

      const result = wm()._focusWindowUnderPointer();

      expect(result).toBe(true);
    });

    it("should not focus when pointer is outside all windows", () => {
      wm().shouldFocusOnHover = true;
      wm().disabled = false;

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0(),
      });

      const windowActor = metaWindow.get_compositor_private();
      windowActor.meta_window = metaWindow;
      global.get_window_actors.mockReturnValue([windowActor]);

      // Pointer is outside window
      global.get_pointer.mockReturnValue([1500, 900]);

      const focusSpy = vi.spyOn(metaWindow, "focus");

      wm()._focusWindowUnderPointer();

      expect(focusSpy).not.toHaveBeenCalled();
    });
  });
});
