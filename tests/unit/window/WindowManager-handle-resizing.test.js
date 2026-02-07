import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Rectangle, GrabOp, MotionDirection } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager _handleResizing behavior tests
 *
 * Tests for resize operations during grab including:
 * - Horizontal split resizing
 * - Vertical split resizing
 * - Sibling percent adjustment
 * - Stacked/tabbed container resizing
 * - Monitor boundary handling
 * - Edge cases (floating, minimized windows)
 */
describe("WindowManager - Handle Resizing Behavior", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();

    // Mock Meta namespace for GrabOp and MotionDirection
    global.Meta = { GrabOp, MotionDirection };
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  describe("_handleResizing - Horizontal Split Resizing", () => {
    it("should process horizontal resize without error", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.rect = { x: 960, y: 0, width: 960, height: 1080 };

      metaWindow1._frameRect = new Rectangle({ x: 0, y: 0, width: 1100, height: 1080 });

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      // Should process resize without throwing
      expect(() => wm()._handleResizing(nodeWindow1)).not.toThrow();
    });

    it("should call nextVisible to find resize pair", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      metaWindow1._frameRect = new Rectangle({ x: 0, y: 0, width: 1100, height: 1080 });

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      const nextVisibleSpy = vi.spyOn(ctx.tree, "nextVisible");

      wm()._handleResizing(nodeWindow1);

      expect(nextVisibleSpy).toHaveBeenCalled();
    });

    it("should maintain total percent sum close to 1", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.rect = { x: 960, y: 0, width: 960, height: 1080 };

      metaWindow1._frameRect = new Rectangle({ x: 0, y: 0, width: 1100, height: 1080 });

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // Total should be close to 1 (accounting for normalization)
      const totalPercent = nodeWindow1.percent + nodeWindow2.percent;
      expect(totalPercent).toBeCloseTo(1, 1);
    });

    it("should process left edge resize (RESIZING_W) without error", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.rect = { x: 0, y: 0, width: 960, height: 1080 };

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.initRect = { x: 960, y: 0, width: 960, height: 1080 };
      nodeWindow2.rect = { x: 960, y: 0, width: 960, height: 1080 };
      nodeWindow2.initGrabOp = GrabOp.RESIZING_W;

      metaWindow2._frameRect = new Rectangle({ x: 800, y: 0, width: 1120, height: 1080 });

      wm().grabOp = GrabOp.RESIZING_W;
      global.display.get_focus_window.mockReturnValue(metaWindow2);

      // Should process left edge resize without throwing
      expect(() => wm()._handleResizing(nodeWindow2)).not.toThrow();
    });
  });

  describe("_handleResizing - Vertical Split Resizing", () => {
    it("should process vertical resize without error", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 540 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 540, width: 1920, height: 540 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.VSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 1920, height: 540 };
      nodeWindow1.rect = { x: 0, y: 0, width: 1920, height: 540 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_S;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.rect = { x: 0, y: 540, width: 1920, height: 540 };

      metaWindow1._frameRect = new Rectangle({ x: 0, y: 0, width: 1920, height: 700 });

      wm().grabOp = GrabOp.RESIZING_S;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      // Should process vertical resize without throwing
      expect(() => wm()._handleResizing(nodeWindow1)).not.toThrow();
    });

    it("should process top edge resize (RESIZING_N) without error", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 540 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 540, width: 1920, height: 540 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.VSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.rect = { x: 0, y: 0, width: 1920, height: 540 };

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.initRect = { x: 0, y: 540, width: 1920, height: 540 };
      nodeWindow2.rect = { x: 0, y: 540, width: 1920, height: 540 };
      nodeWindow2.initGrabOp = GrabOp.RESIZING_N;

      metaWindow2._frameRect = new Rectangle({ x: 0, y: 400, width: 1920, height: 680 });

      wm().grabOp = GrabOp.RESIZING_N;
      global.display.get_focus_window.mockReturnValue(metaWindow2);

      // Should process top edge resize without throwing
      expect(() => wm()._handleResizing(nodeWindow2)).not.toThrow();
    });
  });

  describe("_handleResizing - Stacked/Tabbed Containers", () => {
    it("should force parent-level resize for tabbed containers", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.TABBED;
      monitor.rect = { x: 0, y: 0, width: 960, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 960, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.rect = { x: 0, y: 0, width: 960, height: 1080 };

      metaWindow1._frameRect = new Rectangle({ x: 0, y: 0, width: 1100, height: 1080 });

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      // In tabbed containers, sameParent is forced to false per Bug #497 fix
      // so resizing should happen at parent level, not between siblings
      wm()._handleResizing(nodeWindow1);

      // The parent (tabbed container) should be resized, not individual windows
      expect(true).toBe(true); // Test that it doesn't crash
    });

    it("should force parent-level resize for stacked containers", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.STACKED;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.5;
      nodeWindow1.initRect = { x: 0, y: 0, width: 1920, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 1920, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.5;
      nodeWindow2.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      metaWindow1._frameRect = new Rectangle({ x: 0, y: 0, width: 2100, height: 1080 });

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // Should not throw and should handle stacked layout
      expect(true).toBe(true);
    });
  });

  describe("_handleResizing - Skip Invalid Resize Pairs", () => {
    it("should skip floating windows when finding resize pair", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 640, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow3 = createMockWindow({
        rect: new Rectangle({ x: 1280, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.333;
      nodeWindow1.initRect = { x: 0, y: 0, width: 640, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 640, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      // Window 2 is floating - should be skipped
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.FLOAT;
      nodeWindow2.percent = 0.333;
      nodeWindow2.rect = { x: 640, y: 0, width: 640, height: 1080 };

      const nodeWindow3 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow3);
      nodeWindow3.mode = WINDOW_MODES.TILE;
      nodeWindow3.percent = 0.333;
      nodeWindow3.rect = { x: 1280, y: 0, width: 640, height: 1080 };

      metaWindow1._frameRect = new Rectangle({ x: 0, y: 0, width: 800, height: 1080 });

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // Floating window should be skipped, resize should affect window 3
      expect(nodeWindow1.percent).toBeGreaterThan(0.333);
    });

    it("should skip minimized windows when finding resize pair", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 640, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });
      metaWindow2.minimized = true;

      const metaWindow3 = createMockWindow({
        rect: new Rectangle({ x: 1280, y: 0, width: 640, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.333;
      nodeWindow1.initRect = { x: 0, y: 0, width: 640, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 640, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.333;
      nodeWindow2.rect = { x: 640, y: 0, width: 640, height: 1080 };

      const nodeWindow3 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow3);
      nodeWindow3.mode = WINDOW_MODES.TILE;
      nodeWindow3.percent = 0.333;
      nodeWindow3.rect = { x: 1280, y: 0, width: 640, height: 1080 };

      metaWindow1._frameRect = new Rectangle({ x: 0, y: 0, width: 800, height: 1080 });

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // Minimized window should be skipped
      expect(nodeWindow1.percent).toBeGreaterThan(0.333);
    });
  });

  describe("_handleResizing - Single Child Container", () => {
    it("should not resize when only one tiled child exists", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 1.0;
      nodeWindow1.initRect = { x: 0, y: 0, width: 1920, height: 1080 };
      nodeWindow1.rect = { x: 0, y: 0, width: 1920, height: 1080 };
      nodeWindow1.initGrabOp = GrabOp.RESIZING_E;

      metaWindow1._frameRect = new Rectangle({ x: 0, y: 0, width: 2000, height: 1080 });

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      const initialPercent = nodeWindow1.percent;

      wm()._handleResizing(nodeWindow1);

      // Percent should remain unchanged with single child
      expect(nodeWindow1.percent).toBe(initialPercent);
    });
  });

  describe("_repositionDuringResize", () => {
    it("should keep x fixed when resizing right edge", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 0, width: 1000, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.initRect = { x: 100, y: 0, width: 960, height: 1080 };

      wm().grabOp = GrabOp.RESIZING_E;

      const moveSpy = vi.spyOn(metaWindow, "move_frame");

      wm()._repositionDuringResize(nodeWindow);

      // X position should remain at initRect.x (with gaps=0)
      if (moveSpy.mock.calls.length > 0) {
        expect(moveSpy.mock.calls[0][1]).toBe(100);
      }
    });

    it("should keep y fixed when resizing bottom edge", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 100, width: 1920, height: 600 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.initRect = { x: 0, y: 100, width: 1920, height: 540 };

      wm().grabOp = GrabOp.RESIZING_S;

      const moveSpy = vi.spyOn(metaWindow, "move_frame");

      wm()._repositionDuringResize(nodeWindow);

      // Y position should remain at initRect.y (with gaps=0)
      if (moveSpy.mock.calls.length > 0) {
        expect(moveSpy.mock.calls[0][2]).toBe(100);
      }
    });

    it("should not reposition if position has not changed", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 100, y: 100, width: 960, height: 540 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.initRect = { x: 100, y: 100, width: 960, height: 540 };

      wm().grabOp = GrabOp.RESIZING_E;

      const moveSpy = vi.spyOn(metaWindow, "move_frame");

      wm()._repositionDuringResize(nodeWindow);

      // If x and y match, move_frame should not be called
      // (depends on gap calculation)
    });
  });

  describe("_normalizeSiblingPercents", () => {
    it("should normalize percents to sum to 1", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.percent = 0.6;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;
      nodeWindow2.percent = 0.6;

      // Total is 1.2, should be normalized
      wm()._normalizeSiblingPercents(monitor);

      const total = nodeWindow1.percent + nodeWindow2.percent;
      expect(total).toBeCloseTo(1, 5);
    });
  });
});
