import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../../mocks/helpers/index.js";
import { Rectangle, GrabOp, MotionDirection } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager resize operations tests
 *
 * Tests for resize operations including:
 * - resize(): Resize windows in all directions (UP, DOWN, LEFT, RIGHT)
 * - Testing resize with different amounts (positive/negative)
 * - Testing grab operation handling during resize
 * - Testing event queue management during resize
 */
describe("WindowManager - Resize Operations", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "tiling-mode-enabled": true,
        "focus-on-hover-enabled": false,
      },
    });

    // Add sort_windows_by_stacking to display mock
    ctx.display.sort_windows_by_stacking = vi.fn((windows) => windows);

    // Mock Meta namespace for GrabOp and MotionDirection
    global.Meta = {
      GrabOp,
      MotionDirection,
    };
  });

  // Convenience accessor
  const wm = () => ctx.windowManager;

  describe("resize() - Right/East Direction", () => {
    it("should increase width when resizing right", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_E, 50);

      expect(moveSpy).toHaveBeenCalled();
      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.width).toBe(850); // 800 + 50
      expect(movedRect.height).toBe(600); // unchanged
      expect(movedRect.x).toBe(100); // unchanged
      expect(movedRect.y).toBe(100); // unchanged
    });

    it("should decrease width when resizing right with negative amount", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_E, -50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.width).toBe(750); // 800 - 50
    });

    it("should handle keyboard resize right", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.KEYBOARD_RESIZING_E, 50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.width).toBe(850);
    });
  });

  describe("resize() - Left/West Direction", () => {
    it("should increase width and move left when resizing left", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_W, 50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.width).toBe(850); // 800 + 50
      expect(movedRect.x).toBe(50); // 100 - 50 (moved left to compensate)
      expect(movedRect.height).toBe(600); // unchanged
      expect(movedRect.y).toBe(100); // unchanged
    });

    it("should decrease width and move right when resizing left with negative amount", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_W, -50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.width).toBe(750); // 800 - 50
      expect(movedRect.x).toBe(150); // 100 - (-50) = 100 + 50
    });

    it("should handle keyboard resize left", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.KEYBOARD_RESIZING_W, 50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.width).toBe(850);
      expect(movedRect.x).toBe(50);
    });
  });

  describe("resize() - Up/North Direction", () => {
    it("should increase height when resizing up", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_N, 50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.height).toBe(650); // 600 + 50
      expect(movedRect.width).toBe(800); // unchanged
      expect(movedRect.x).toBe(100); // unchanged
      expect(movedRect.y).toBe(100); // unchanged (note: implementation doesn't adjust y for UP)
    });

    it("should decrease height when resizing up with negative amount", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_N, -50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.height).toBe(550); // 600 - 50
    });

    it("should handle keyboard resize up", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.KEYBOARD_RESIZING_N, 50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.height).toBe(650);
    });
  });

  describe("resize() - Down/South Direction", () => {
    it("should increase height and move up when resizing down", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_S, 50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.height).toBe(650); // 600 + 50
      expect(movedRect.y).toBe(50); // 100 - 50 (moved up to compensate)
      expect(movedRect.width).toBe(800); // unchanged
      expect(movedRect.x).toBe(100); // unchanged
    });

    it("should decrease height and move down when resizing down with negative amount", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_S, -50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.height).toBe(550); // 600 - 50
      expect(movedRect.y).toBe(150); // 100 - (-50) = 100 + 50
    });

    it("should handle keyboard resize down", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.KEYBOARD_RESIZING_S, 50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.height).toBe(650);
      expect(movedRect.y).toBe(50);
    });
  });

  describe("resize() - Grab Operation Handling", () => {
    it("should call _handleGrabOpBegin at start of resize", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const beginSpy = vi.spyOn(wm(), "_handleGrabOpBegin");

      wm().resize(GrabOp.RESIZING_E, 50);

      expect(beginSpy).toHaveBeenCalledWith(ctx.display, metaWindow, GrabOp.RESIZING_E);
    });

    it("should queue event to call _handleGrabOpEnd", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const queueSpy = vi.spyOn(wm(), "queueEvent");

      wm().resize(GrabOp.RESIZING_E, 50);

      expect(queueSpy).toHaveBeenCalled();
      const eventObj = queueSpy.mock.calls[0][0];
      expect(eventObj.name).toBe("manual-resize");
      expect(eventObj.callback).toBeInstanceOf(Function);
    });

    it("should use 50ms interval for resize event queue", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const queueSpy = vi.spyOn(wm(), "queueEvent");

      wm().resize(GrabOp.RESIZING_E, 50);

      expect(queueSpy).toHaveBeenCalledWith(expect.any(Object), 50);
    });
  });

  describe("resize() - Edge Cases", () => {
    it("should handle zero resize amount", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_E, 0);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.width).toBe(800); // unchanged
      expect(movedRect.height).toBe(600); // unchanged
    });

    it("should handle large resize amounts", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_E, 1000);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.width).toBe(1800); // 800 + 1000
    });

    it("should handle very negative resize amounts", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_E, -500);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.width).toBe(300); // 800 - 500
    });
  });

  describe("resize() - Integration with move()", () => {
    it("should call move() with updated rectangle", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().resize(GrabOp.RESIZING_E, 50);

      expect(moveSpy).toHaveBeenCalledWith(metaWindow, expect.any(Object));
    });

    it("should preserve original rect properties not affected by direction", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 200, width: 800, height: 600 }),
        workspace: ctx.workspaces[0],
      });

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      // Resize horizontally should not affect y or height
      wm().resize(GrabOp.RESIZING_E, 50);

      const movedRect = moveSpy.mock.calls[0][1];
      expect(movedRect.y).toBe(200); // unchanged
      expect(movedRect.height).toBe(600); // unchanged
    });
  });

  describe("resize() - All Directions Combined", () => {
    it("should correctly resize in all four cardinal directions", () => {
      const initialRect = new Rectangle({ x: 500, y: 400, width: 800, height: 600 });

      const directions = [
        { grabOp: GrabOp.RESIZING_E, amount: 100, expectWidth: 900, expectX: 500 },
        { grabOp: GrabOp.RESIZING_W, amount: 100, expectWidth: 900, expectX: 400 },
        { grabOp: GrabOp.RESIZING_N, amount: 100, expectHeight: 700, expectY: 400 },
        { grabOp: GrabOp.RESIZING_S, amount: 100, expectHeight: 700, expectY: 300 },
      ];

      directions.forEach(({ grabOp, amount, expectWidth, expectX, expectHeight, expectY }) => {
        const metaWindow = createMockWindow({
          rect: initialRect.copy(),
          workspace: ctx.workspaces[0],
        });
        ctx.display.get_focus_window.mockReturnValue(metaWindow);

        const moveSpy = vi.spyOn(wm(), "move");

        wm().resize(grabOp, amount);

        const movedRect = moveSpy.mock.calls[0][1];
        if (expectWidth) expect(movedRect.width).toBe(expectWidth);
        if (expectX !== undefined) expect(movedRect.x).toBe(expectX);
        if (expectHeight) expect(movedRect.height).toBe(expectHeight);
        if (expectY !== undefined) expect(movedRect.y).toBe(expectY);

        moveSpy.mockRestore();
      });
    });
  });
});
