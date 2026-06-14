import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Rectangle, GrabOp, MotionDirection } from "../../mocks/gnome/Meta.js";
import { Bin } from "../../mocks/gnome/St.js";

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
 *
 * IMPORTANT: the production resize delta is `get_frame_rect().width - initRect.width`.
 * The mock's get_frame_rect() returns the window's `_rect`, which `move_resize_frame()`
 * updates — so each test simulates the drag by calling move_resize_frame() to the new
 * size (NOT by setting a dead `_frameRect` property), then asserts the resulting
 * node.percent shares actually shifted.
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
    it("grows the grabbed window and shrinks its split sibling (RESIZING_E)", () => {
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

      // Drag the right edge: frame grows 960 -> 1100 (changePx = +140).
      metaWindow1.move_resize_frame(false, 0, 0, 1100, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      expect(nodeWindow1.percent).toBeGreaterThan(0.5);
      expect(nodeWindow2.percent).toBeLessThan(0.5);
      expect(nodeWindow1.percent + nodeWindow2.percent).toBeCloseTo(1, 5);
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

      metaWindow1.move_resize_frame(false, 0, 0, 1100, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      const nextVisibleSpy = vi.spyOn(ctx.tree, "nextVisible");

      wm()._handleResizing(nodeWindow1);

      expect(nextVisibleSpy).toHaveBeenCalled();
    });

    it("redistributes the resize so sibling percents still sum to 1", () => {
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

      metaWindow1.move_resize_frame(false, 0, 0, 1100, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // The grabbed window grew, and the pair absorbed the loss; sum stays ~1.
      expect(nodeWindow1.percent).toBeGreaterThan(0.5);
      const totalPercent = nodeWindow1.percent + nodeWindow2.percent;
      expect(totalPercent).toBeCloseTo(1, 1);
    });

    it("grows the grabbed window and shrinks its left sibling (RESIZING_W)", () => {
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

      // Drag window2's LEFT edge leftward: frame grows 960 -> 1120, x 960 -> 800.
      metaWindow2.move_resize_frame(false, 800, 0, 1120, 1080);

      wm().grabOp = GrabOp.RESIZING_W;
      global.display.get_focus_window.mockReturnValue(metaWindow2);

      wm()._handleResizing(nodeWindow2);

      expect(nodeWindow2.percent).toBeGreaterThan(0.5);
      expect(nodeWindow1.percent).toBeLessThan(0.5);
    });
  });

  describe("_handleResizing - Vertical Split Resizing", () => {
    it("grows the grabbed window and shrinks its split sibling (RESIZING_S)", () => {
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

      // Drag the bottom edge: frame grows 540 -> 700 (changePx = +160).
      metaWindow1.move_resize_frame(false, 0, 0, 1920, 700);

      wm().grabOp = GrabOp.RESIZING_S;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      expect(nodeWindow1.percent).toBeGreaterThan(0.5);
      expect(nodeWindow2.percent).toBeLessThan(0.5);
      expect(nodeWindow1.percent + nodeWindow2.percent).toBeCloseTo(1, 5);
    });

    it("grows the grabbed window and shrinks its top sibling (RESIZING_N)", () => {
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

      // Drag window2's TOP edge upward: frame grows 540 -> 680, y 540 -> 400.
      metaWindow2.move_resize_frame(false, 0, 400, 1920, 680);

      wm().grabOp = GrabOp.RESIZING_N;
      global.display.get_focus_window.mockReturnValue(metaWindow2);

      wm()._handleResizing(nodeWindow2);

      expect(nodeWindow2.percent).toBeGreaterThan(0.5);
      expect(nodeWindow1.percent).toBeLessThan(0.5);
    });
  });

  describe("_handleResizing - Stacked/Tabbed Containers", () => {
    // Bug #497 (forge-pak): a tab inside a tabbed/stacked container shares the
    // container's rect, so a sibling tab is never a meaningful resize pair.
    // Resizing a tab must resize the ENCLOSING container against its split
    // sibling. These tests nest the tabbed/stacked container in an HSPLIT next
    // to a plain window and assert the container (not the tab) takes the delta.
    const buildNestedContainer = (containerLayout) => {
      const metaTab1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaTab2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const metaSibling = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = containerLayout;
      container.percent = 0.5;
      container.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      container.rect = { x: 0, y: 0, width: 960, height: 1080 };

      const tab1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaTab1);
      tab1.mode = WINDOW_MODES.TILE;
      tab1.percent = 0.5;
      tab1.initRect = { x: 0, y: 0, width: 960, height: 1080 };
      tab1.rect = { x: 0, y: 0, width: 960, height: 1080 };
      tab1.initGrabOp = GrabOp.RESIZING_E;

      const tab2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaTab2);
      tab2.mode = WINDOW_MODES.TILE;
      tab2.percent = 0.5;
      tab2.rect = { x: 0, y: 0, width: 960, height: 1080 };

      const sibling = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaSibling);
      sibling.mode = WINDOW_MODES.TILE;
      sibling.percent = 0.5;
      sibling.rect = { x: 960, y: 0, width: 960, height: 1080 };

      // Drag tab1's right edge: its frame (== container frame) grows 960 -> 1100.
      metaTab1.move_resize_frame(false, 0, 0, 1100, 1080);
      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaTab1);

      return { container, tab1, tab2, sibling };
    };

    it("resizes a TABBED container against its split sibling, tabs stay valid (Bug #497)", () => {
      const { container, tab1, tab2, sibling } = buildNestedContainer(LAYOUT_TYPES.TABBED);

      wm()._handleResizing(tab1);

      // The container took the delta against its split sibling...
      expect(container.percent).toBeGreaterThan(0.5);
      expect(sibling.percent).toBeLessThan(0.5);
      expect(container.percent + sibling.percent).toBeCloseTo(1, 5);
      // ...and the sibling tabs keep valid positive shares (never collapse).
      expect(tab1.percent).toBeGreaterThan(0);
      expect(tab2.percent).toBeGreaterThan(0);
    });

    it("resizes a STACKED container against its split sibling, tabs stay valid (Bug #497)", () => {
      const { container, tab1, tab2, sibling } = buildNestedContainer(LAYOUT_TYPES.STACKED);

      wm()._handleResizing(tab1);

      expect(container.percent).toBeGreaterThan(0.5);
      expect(sibling.percent).toBeLessThan(0.5);
      expect(container.percent + sibling.percent).toBeCloseTo(1, 5);
      expect(tab1.percent).toBeGreaterThan(0);
      expect(tab2.percent).toBeGreaterThan(0);
    });
  });

  describe("_handleResizing - Skip Invalid Resize Pairs", () => {
    it("skips a floating window and lands the delta on the next tiled sibling", () => {
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

      // Window 2 is floating - the immediate right neighbor, must be skipped.
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.FLOAT;
      nodeWindow2.percent = 0.333;
      nodeWindow2.rect = { x: 640, y: 0, width: 640, height: 1080 };

      const nodeWindow3 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow3);
      nodeWindow3.mode = WINDOW_MODES.TILE;
      nodeWindow3.percent = 0.333;
      nodeWindow3.rect = { x: 1280, y: 0, width: 640, height: 1080 };

      metaWindow1.move_resize_frame(false, 0, 0, 800, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // Grabbed window grew; the floating window is left untouched; the delta
      // reached the next TILED sibling (window3), proving window2 was skipped.
      expect(nodeWindow1.percent).toBeGreaterThan(0.333);
      expect(nodeWindow2.percent).toBeCloseTo(0.333, 3);
      expect(Math.abs(nodeWindow3.percent - 0.333)).toBeGreaterThan(0.02);
      expect(nodeWindow1.percent).toBeGreaterThan(nodeWindow3.percent);
    });

    it("skips a minimized window and lands the delta on the next tiled sibling", () => {
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

      metaWindow1.move_resize_frame(false, 0, 0, 800, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      wm()._handleResizing(nodeWindow1);

      // Minimized window2 is skipped; the delta reaches window3.
      expect(nodeWindow1.percent).toBeGreaterThan(0.333);
      expect(nodeWindow2.percent).toBeCloseTo(0.333, 3);
      expect(Math.abs(nodeWindow3.percent - 0.333)).toBeGreaterThan(0.02);
      expect(nodeWindow1.percent).toBeGreaterThan(nodeWindow3.percent);
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

      // Even with a real frame delta, a lone tiled child has no resize pair.
      metaWindow1.move_resize_frame(false, 0, 0, 2000, 1080);

      wm().grabOp = GrabOp.RESIZING_E;
      global.display.get_focus_window.mockReturnValue(metaWindow1);

      const initialPercent = nodeWindow1.percent;

      wm()._handleResizing(nodeWindow1);

      // Percent should remain unchanged with single child
      expect(nodeWindow1.percent).toBe(initialPercent);
    });
  });

  describe("_repositionDuringResize", () => {
    it("should restore x to initRect.x when resizing right edge", () => {
      // Frame has drifted right (x=150) from where the tile started (x=100).
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 150, y: 0, width: 1000, height: 1080 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.initRect = { x: 100, y: 0, width: 960, height: 1080 };

      wm().grabOp = GrabOp.RESIZING_E;

      const moveSpy = vi.spyOn(metaWindow, "move_frame");

      wm()._repositionDuringResize(nodeWindow);

      // Resizing the right edge must pin x back to initRect.x (gaps=0).
      expect(moveSpy).toHaveBeenCalled();
      expect(moveSpy.mock.calls[0][1]).toBe(100);
    });

    it("should restore y to initRect.y when resizing bottom edge", () => {
      // Frame has drifted down (y=150) from where the tile started (y=100).
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 150, width: 1920, height: 600 }),
        workspace: workspace0(),
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.initRect = { x: 0, y: 100, width: 1920, height: 540 };

      wm().grabOp = GrabOp.RESIZING_S;

      const moveSpy = vi.spyOn(metaWindow, "move_frame");

      wm()._repositionDuringResize(nodeWindow);

      // Resizing the bottom edge must pin y back to initRect.y (gaps=0).
      expect(moveSpy).toHaveBeenCalled();
      expect(moveSpy.mock.calls[0][2]).toBe(100);
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

      // Frame x/y already match initRect, so the anti-travel reposition is a no-op.
      expect(moveSpy).not.toHaveBeenCalled();
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
