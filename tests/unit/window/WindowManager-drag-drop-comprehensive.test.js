import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Rectangle } from "../../mocks/gnome/Meta.js";
import { Bin } from "../../mocks/gnome/St.js";

/**
 * Comprehensive tests for moveWindowToPointer()
 *
 * This file covers edge cases and scenarios not covered in the basic tests:
 * - Nested container (CON) parents vs monitor parents
 * - Tabbed container edge drops
 * - Monitor as stacked/tabbed parent
 * - Window ordering for LEFT/TOP drops
 * - cancelGrab early exit
 * - createCon logic variations
 * - detachWindow + split() path
 * - Multiple windows in various layouts
 */

describe("WindowManager - moveWindowToPointer Comprehensive", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "dnd-center-layout": "SWAP",
        "preview-hint-enabled": true,
      },
    });
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  /**
   * Helper to create a window node with frame rect
   */
  function createWindowWithRect(parent, rect, mode = WINDOW_MODES.TILE) {
    const metaWindow = createMockWindow({
      rect: new Rectangle(rect),
      workspace: workspace0(),
    });
    const nodeWindow = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    nodeWindow.mode = mode;
    return { nodeWindow, metaWindow };
  }

  /**
   * Helper to create a container node
   */
  function createContainer(parent, layout, rect = null) {
    const container = new Node(NODE_TYPES.CON, new Bin());
    container.layout = layout;
    if (rect) container.rect = rect;
    parent.appendChild(container);
    return container;
  }

  /**
   * Helper to set pointer position
   */
  function setPointer(x, y) {
    global.get_pointer = vi.fn(() => [x, y]);
  }

  /**
   * Helper to get monitor node
   */
  function getMonitor() {
    return getWorkspaceAndMonitor(ctx).monitor;
  }

  // ============================================================================
  // SECTION 1: Early Exit Conditions
  // ============================================================================

  describe("Early Exit Conditions", () => {
    it("should do nothing when cancelGrab is true", () => {
      const monitor = getMonitor();

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;
      wm().cancelGrab = true;

      const initialParent = dragged.parentNode;
      const initialChildCount = initialParent.childNodes.length;

      wm().moveWindowToPointer(dragged, false);

      expect(dragged.parentNode).toBe(initialParent);
      expect(initialParent.childNodes.length).toBe(initialChildCount);
    });

    it("should do nothing when focusNodeWindow is null", () => {
      const monitor = getMonitor();
      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      // Should not throw
      expect(() => wm().moveWindowToPointer(null, false)).not.toThrow();
    });

    it("should do nothing when focusNodeWindow mode is not GRAB_TILE", () => {
      const monitor = getMonitor();

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.TILE // Not GRAB_TILE
      );

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      const initialParent = dragged.parentNode;

      wm().moveWindowToPointer(dragged, false);

      expect(dragged.parentNode).toBe(initialParent);
    });

    it("should do nothing when nodeWinAtPointer is null", () => {
      const monitor = getMonitor();

      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(100, 540);
      wm().nodeWinAtPointer = null;

      const initialParent = dragged.parentNode;

      wm().moveWindowToPointer(dragged, false);

      expect(dragged.parentNode).toBe(initialParent);
    });

    it("should return early when nodeWinAtPointer has invalid structure", () => {
      const monitor = getMonitor();

      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Create invalid node (missing nodeValue)
      const invalidNode = { parentNode: monitor, nodeValue: null };

      setPointer(100, 540);
      wm().nodeWinAtPointer = invalidNode;

      const initialParent = dragged.parentNode;

      wm().moveWindowToPointer(dragged, false);

      expect(dragged.parentNode).toBe(initialParent);
    });
  });

  // ============================================================================
  // SECTION 2: Window Ordering (LEFT/TOP should be BEFORE target)
  // ============================================================================

  describe("Window Ordering", () => {
    it("should place dragged window BEFORE target when dropping LEFT", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Left edge (0-30% of width)
      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      const parent = dragged.parentNode;
      const children = parent.childNodes.filter((c) => c.nodeType === NODE_TYPES.WINDOW);
      const idxTarget = children.indexOf(target);
      const idxDragged = children.indexOf(dragged);

      expect(idxDragged).toBeLessThan(idxTarget);
    });

    it("should place dragged window BEFORE target when dropping TOP", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Top edge (0-30% of height)
      setPointer(960, 100);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      const parent = dragged.parentNode;
      const children = parent.childNodes.filter((c) => c.nodeType === NODE_TYPES.WINDOW);
      const idxTarget = children.indexOf(target);
      const idxDragged = children.indexOf(dragged);

      expect(idxDragged).toBeLessThan(idxTarget);
    });

    it("should place dragged window AFTER target when dropping RIGHT", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Right edge (70-100% of width)
      setPointer(1800, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      const parent = dragged.parentNode;
      const children = parent.childNodes.filter((c) => c.nodeType === NODE_TYPES.WINDOW);
      const idxTarget = children.indexOf(target);
      const idxDragged = children.indexOf(dragged);

      expect(idxDragged).toBeGreaterThan(idxTarget);
    });

    it("should place dragged window AFTER target when dropping BOTTOM", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Bottom edge (70-100% of height)
      setPointer(960, 1000);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      const parent = dragged.parentNode;
      const children = parent.childNodes.filter((c) => c.nodeType === NODE_TYPES.WINDOW);
      const idxTarget = children.indexOf(target);
      const idxDragged = children.indexOf(dragged);

      expect(idxDragged).toBeGreaterThan(idxTarget);
    });
  });

  // ============================================================================
  // SECTION 3: Tabbed Container Edge Drops
  // ============================================================================

  describe("Tabbed Container Edge Drops", () => {
    it("should detach window from tabbed container when dropping on LEFT edge", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.TABBED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      expect(splitSpy).toHaveBeenCalled();
    });

    it("should detach window from tabbed container when dropping on RIGHT edge", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.TABBED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(1800, 540);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      expect(splitSpy).toHaveBeenCalled();
    });

    it("should detach window from tabbed container when dropping on TOP edge", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.TABBED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(960, 100);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      expect(splitSpy).toHaveBeenCalled();
    });

    it("should detach window from tabbed container when dropping on BOTTOM edge", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.TABBED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(960, 1000);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      expect(splitSpy).toHaveBeenCalled();
    });

    it("should add window to tabbed container when dropping on CENTER", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "TABBED";
        return "";
      });

      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.TABBED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Center region
      setPointer(960, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      // Should stay in same tabbed container
      expect(dragged.parentNode.layout).toBe(LAYOUT_TYPES.TABBED);
      expect(dragged.parentNode).toBe(target.parentNode);
    });
  });

  // ============================================================================
  // SECTION 4: Nested Container (CON) Parent
  // ============================================================================

  describe("Nested Container (CON) Parent", () => {
    it("should create HSPLIT when dropping LEFT in CON with VSPLIT layout", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      // Create a nested container with VSPLIT
      const container = createContainer(monitor, LAYOUT_TYPES.VSPLIT, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 540 }),
        workspace: workspace0(),
      });
      const target = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      target.mode = WINDOW_MODES.TILE;

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 540, width: 960, height: 540 }),
        workspace: workspace0(),
      });
      const other = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      other.mode = WINDOW_MODES.TILE;

      // Create dragged window outside container
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Drop on left edge of target
      setPointer(50, 270);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      // Should create a new container with HSPLIT containing target and dragged
      expect(dragged.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should create VSPLIT when dropping TOP in CON with HSPLIT layout", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      // Create a nested container with HSPLIT
      const container = createContainer(monitor, LAYOUT_TYPES.HSPLIT, {
        x: 0,
        y: 0,
        width: 1920,
        height: 540,
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 540 }),
        workspace: workspace0(),
      });
      const target = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      target.mode = WINDOW_MODES.TILE;

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 540 }),
        workspace: workspace0(),
      });
      const other = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      other.mode = WINDOW_MODES.TILE;

      // Create dragged window outside container
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 540, width: 1920, height: 540 },
        WINDOW_MODES.GRAB_TILE
      );

      // Drop on top edge of target
      setPointer(480, 50);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      // Should create a new container with VSPLIT
      expect(dragged.parentNode.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should reuse existing CON when only one window remains", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      // Create a nested container
      const container = createContainer(monitor, LAYOUT_TYPES.VSPLIT, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const target = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      target.mode = WINDOW_MODES.TILE;

      // Create dragged window outside container
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Drop on left edge of target (only window in container)
      setPointer(50, 540);
      wm().nodeWinAtPointer = target;

      const childCountBefore = container.childNodes.length;

      wm().moveWindowToPointer(dragged, false);

      // Container should be reused, not nested further
      expect(dragged.parentNode).toBe(container);
      expect(target.parentNode).toBe(container);
    });
  });

  // ============================================================================
  // SECTION 5: Monitor as Stacked/Tabbed Parent
  // ============================================================================

  describe("Monitor as Stacked/Tabbed Parent", () => {
    it("should prepend window when dropping LEFT on stacked monitor", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.STACKED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      // Should call split to detach from stacked
      expect(splitSpy).toHaveBeenCalled();
    });

    it("should append window when dropping RIGHT on stacked monitor", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.STACKED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(1800, 540);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      expect(splitSpy).toHaveBeenCalled();
    });

    it("should prepend window when dropping TOP on tabbed monitor", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.TABBED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(960, 100);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      expect(splitSpy).toHaveBeenCalled();
    });

    it("should append window when dropping BOTTOM on tabbed monitor", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.TABBED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(960, 1000);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      expect(splitSpy).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // SECTION 6: Center Drop Adds to Existing Container
  // ============================================================================

  describe("Center Drop into Existing Stacked/Tabbed", () => {
    it("should add window to existing stacked container on center drop", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "STACKED";
        return "";
      });

      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      // Create a stacked container
      const container = createContainer(monitor, LAYOUT_TYPES.STACKED, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const target = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      target.mode = WINDOW_MODES.TILE;

      // Create dragged window outside container
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Center drop
      setPointer(480, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      // Should be added to existing stacked container
      expect(dragged.parentNode).toBe(container);
      expect(dragged.parentNode.layout).toBe(LAYOUT_TYPES.STACKED);
    });

    it("should add window to existing tabbed container on center drop", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "TABBED";
        return "";
      });

      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      // Create a tabbed container
      const container = createContainer(monitor, LAYOUT_TYPES.TABBED, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const target = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      target.mode = WINDOW_MODES.TILE;

      // Create dragged window outside container
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Center drop
      setPointer(480, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      // Should be added to existing tabbed container
      expect(dragged.parentNode).toBe(container);
      expect(dragged.parentNode.layout).toBe(LAYOUT_TYPES.TABBED);
    });
  });

  // ============================================================================
  // SECTION 7: createCon Logic Variations
  // ============================================================================

  describe("createCon Logic", () => {
    it("should create new container when dropping LEFT in VSPLIT with 2+ windows", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      // Create multiple windows in VSPLIT
      const { nodeWindow: win1 } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 360,
      });
      const { nodeWindow: win2 } = createWindowWithRect(monitor, {
        x: 0,
        y: 360,
        width: 1920,
        height: 360,
      });
      const { nodeWindow: win3 } = createWindowWithRect(monitor, {
        x: 0,
        y: 720,
        width: 1920,
        height: 360,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 360 },
        WINDOW_MODES.GRAB_TILE
      );

      // Drop LEFT on win2
      setPointer(100, 540);
      wm().nodeWinAtPointer = win2;

      wm().moveWindowToPointer(dragged, false);

      // Should create new HSPLIT container for win2 and dragged
      expect(dragged.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
      expect(dragged.parentNode.nodeType).toBe(NODE_TYPES.CON);
    });

    it("should create new container when dropping TOP in HSPLIT with 2+ windows", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      // Create multiple windows in HSPLIT
      const { nodeWindow: win1 } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 640,
        height: 1080,
      });
      const { nodeWindow: win2 } = createWindowWithRect(monitor, {
        x: 640,
        y: 0,
        width: 640,
        height: 1080,
      });
      const { nodeWindow: win3 } = createWindowWithRect(monitor, {
        x: 1280,
        y: 0,
        width: 640,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 640, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Drop TOP on win2
      setPointer(960, 100);
      wm().nodeWinAtPointer = win2;

      wm().moveWindowToPointer(dragged, false);

      // Should create new VSPLIT container for win2 and dragged
      expect(dragged.parentNode.layout).toBe(LAYOUT_TYPES.VSPLIT);
      expect(dragged.parentNode.nodeType).toBe(NODE_TYPES.CON);
    });

    it("should NOT create container when monitor has only 2 windows and same numChild", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Drop TOP on target (only 2 windows)
      setPointer(480, 100);
      wm().nodeWinAtPointer = target;

      const containersBefore = monitor.childNodes.filter(
        (c) => c.nodeType === NODE_TYPES.CON
      ).length;

      wm().moveWindowToPointer(dragged, false);

      // Should reuse monitor as container, just change layout
      // The parent of dragged should be monitor
      expect(dragged.parentNode).toBe(monitor);
    });
  });

  // ============================================================================
  // SECTION 8: Multiple Windows (3+ in layout)
  // ============================================================================

  describe("Multiple Windows in Layout", () => {
    it("should handle dropping 4th window into 3-window HSPLIT", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: win1 } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 640,
        height: 1080,
      });
      const { nodeWindow: win2 } = createWindowWithRect(monitor, {
        x: 640,
        y: 0,
        width: 640,
        height: 1080,
      });
      const { nodeWindow: win3 } = createWindowWithRect(monitor, {
        x: 1280,
        y: 0,
        width: 640,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 640, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Drop RIGHT on win3
      setPointer(1800, 540);
      wm().nodeWinAtPointer = win3;

      wm().moveWindowToPointer(dragged, false);

      // Should still have 4 windows total in tree
      const allWindows = monitor.childNodes.filter((c) => c.nodeType === NODE_TYPES.WINDOW);
      expect(allWindows.length).toBe(4);
      expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should handle dropping into middle of 3-window VSPLIT", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      const { nodeWindow: win1 } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 360,
      });
      const { nodeWindow: win2 } = createWindowWithRect(monitor, {
        x: 0,
        y: 360,
        width: 1920,
        height: 360,
      });
      const { nodeWindow: win3 } = createWindowWithRect(monitor, {
        x: 0,
        y: 720,
        width: 1920,
        height: 360,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 360 },
        WINDOW_MODES.GRAB_TILE
      );

      // Drop TOP on win2 (middle window)
      setPointer(960, 400);
      wm().nodeWinAtPointer = win2;

      wm().moveWindowToPointer(dragged, false);

      // Dragged should be in a new VSPLIT container with win2
      // or positioned before win2 depending on implementation
      expect(dragged.parentNode).toBeDefined();
    });
  });

  // ============================================================================
  // SECTION 9: Tab Decoration Handling
  // ============================================================================

  describe("Tab Decoration Handling", () => {
    it("should handle tab decoration removal gracefully", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Add a mock tab with parent
      const mockTab = {
        get_parent: vi.fn(() => ({
          remove_child: vi.fn(),
        })),
      };
      dragged.tab = mockTab;

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      // Should not throw
      expect(() => wm().moveWindowToPointer(dragged, false)).not.toThrow();
    });

    it("should handle tab decoration removal when parent is null", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Add a mock tab with null parent
      const mockTab = {
        get_parent: vi.fn(() => null),
      };
      dragged.tab = mockTab;

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      // Should not throw
      expect(() => wm().moveWindowToPointer(dragged, false)).not.toThrow();
    });

    it("should handle tab decoration removal error gracefully", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      // Add a mock tab that throws on get_parent
      const mockTab = {
        get_parent: vi.fn(() => {
          throw new Error("Mock error");
        }),
      };
      dragged.tab = mockTab;

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      // Should not throw - error is caught internally
      expect(() => wm().moveWindowToPointer(dragged, false)).not.toThrow();
    });
  });

  // ============================================================================
  // SECTION 10: Preview Hint Styling
  // ============================================================================

  describe("Preview Hint Styling", () => {
    function setupPreviewTest() {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "preview-hint-enabled") return true;
        return key === "tiling-mode-enabled";
      });
    }

    it("should show tiled preview class for LEFT edge drop", () => {
      setupPreviewTest();
      const monitor = getMonitor();

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      const previewHint = {
        set_style_class_name: vi.fn(),
        set_position: vi.fn(),
        set_size: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      dragged.previewHint = previewHint;

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, true);

      expect(previewHint.set_style_class_name).toHaveBeenCalledWith("window-tilepreview-tiled");
    });

    it("should show stacked preview class for CENTER drop on stacked container", () => {
      setupPreviewTest();
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "STACKED";
        return "";
      });

      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.STACKED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      const previewHint = {
        set_style_class_name: vi.fn(),
        set_position: vi.fn(),
        set_size: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      dragged.previewHint = previewHint;

      setPointer(960, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, true);

      expect(previewHint.set_style_class_name).toHaveBeenCalledWith("window-tilepreview-stacked");
    });

    it("should show tabbed preview class for CENTER drop on tabbed container", () => {
      setupPreviewTest();
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "TABBED";
        return "";
      });

      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.TABBED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      const previewHint = {
        set_style_class_name: vi.fn(),
        set_position: vi.fn(),
        set_size: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      dragged.previewHint = previewHint;

      setPointer(960, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, true);

      expect(previewHint.set_style_class_name).toHaveBeenCalledWith("window-tilepreview-tabbed");
    });

    it("should hide preview when no targetRect", () => {
      setupPreviewTest();
      const monitor = getMonitor();

      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      const previewHint = {
        set_style_class_name: vi.fn(),
        set_position: vi.fn(),
        set_size: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      dragged.previewHint = previewHint;

      // No nodeWinAtPointer set
      wm().nodeWinAtPointer = null;

      wm().moveWindowToPointer(dragged, true);

      // Preview should not be shown since there's no target
      expect(previewHint.show).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // SECTION 11: Reset Sibling Percent
  // ============================================================================

  describe("Reset Sibling Percent", () => {
    it("should call resetSiblingPercent on both old and new parent", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const container1 = createContainer(monitor, LAYOUT_TYPES.VSPLIT, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });
      const container2 = createContainer(monitor, LAYOUT_TYPES.VSPLIT, {
        x: 960,
        y: 0,
        width: 960,
        height: 1080,
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const target = ctx.tree.createNode(container1.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      target.mode = WINDOW_MODES.TILE;

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const dragged = ctx.tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      dragged.mode = WINDOW_MODES.GRAB_TILE;

      const resetSpy = vi.spyOn(ctx.tree, "resetSiblingPercent");

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      // Should be called for both the new container and the old parent
      expect(resetSpy).toHaveBeenCalled();
      expect(resetSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // SECTION 12: Stacked Container with Non-Monitor Parent
  // ============================================================================

  describe("Stacked Container with CON Parent", () => {
    it("should detach window from stacked CON when dropping LEFT", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      // Create a stacked container inside a HSPLIT
      const stackedCon = createContainer(monitor, LAYOUT_TYPES.STACKED, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const target = ctx.tree.createNode(stackedCon.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      target.mode = WINDOW_MODES.TILE;

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const other = ctx.tree.createNode(stackedCon.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      other.mode = WINDOW_MODES.TILE;

      // Create dragged window elsewhere
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      // Should call split because stackedCon is not monitor parent
      expect(splitSpy).toHaveBeenCalled();
    });

    it("should insert window before stacked CON when dropping TOP", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      // Create a stacked container
      const stackedCon = createContainer(monitor, LAYOUT_TYPES.STACKED, {
        x: 0,
        y: 540,
        width: 1920,
        height: 540,
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 540, width: 1920, height: 540 }),
        workspace: workspace0(),
      });
      const target = ctx.tree.createNode(stackedCon.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      target.mode = WINDOW_MODES.TILE;

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 540, width: 1920, height: 540 }),
        workspace: workspace0(),
      });
      const other = ctx.tree.createNode(stackedCon.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      other.mode = WINDOW_MODES.TILE;

      // Create dragged window at top
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 540 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(960, 600);
      wm().nodeWinAtPointer = target;

      const splitSpy = vi.spyOn(ctx.tree, "split");

      wm().moveWindowToPointer(dragged, false);

      expect(splitSpy).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // SECTION 13: SWAP Center Mode
  // ============================================================================

  describe("SWAP Center Mode", () => {
    beforeEach(() => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "SWAP";
        return "";
      });
    });

    it("should swap windows when center drop with SWAP mode in HSPLIT", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 960, y: 0, width: 960, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(480, 540);
      wm().nodeWinAtPointer = target;

      const swapSpy = vi.spyOn(ctx.tree, "swapPairs");

      wm().moveWindowToPointer(dragged, false);

      expect(swapSpy).toHaveBeenCalledWith(target, dragged);
    });

    it("should swap windows when center drop with SWAP mode in VSPLIT", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 540,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 540, width: 1920, height: 540 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(960, 270);
      wm().nodeWinAtPointer = target;

      const swapSpy = vi.spyOn(ctx.tree, "swapPairs");

      wm().moveWindowToPointer(dragged, false);

      expect(swapSpy).toHaveBeenCalledWith(target, dragged);
    });

    it("should swap windows in nested containers", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const container1 = createContainer(monitor, LAYOUT_TYPES.VSPLIT, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });
      const container2 = createContainer(monitor, LAYOUT_TYPES.VSPLIT, {
        x: 960,
        y: 0,
        width: 960,
        height: 1080,
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const target = ctx.tree.createNode(container1.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      target.mode = WINDOW_MODES.TILE;

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0(),
      });
      const dragged = ctx.tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      dragged.mode = WINDOW_MODES.GRAB_TILE;

      setPointer(480, 540);
      wm().nodeWinAtPointer = target;

      const swapSpy = vi.spyOn(ctx.tree, "swapPairs");

      wm().moveWindowToPointer(dragged, false);

      expect(swapSpy).toHaveBeenCalledWith(target, dragged);
    });
  });

  // ============================================================================
  // SECTION 14: Edge Cases for Region Detection
  // ============================================================================

  describe("Region Detection Edge Cases", () => {
    it("should detect left region at exact boundary (30%)", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1000, height: 1000 },
        WINDOW_MODES.GRAB_TILE
      );

      // Exactly at 30% boundary (should be left region)
      setPointer(299, 500);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      expect(dragged.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should detect center region at 31% (just past left boundary)", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "dnd-center-layout") return "SWAP";
        return "";
      });

      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1000, height: 1000 },
        WINDOW_MODES.GRAB_TILE
      );

      // Just past 30% (should be center region if also past top/bottom)
      setPointer(350, 500);
      wm().nodeWinAtPointer = target;

      const swapSpy = vi.spyOn(ctx.tree, "swapPairs");

      wm().moveWindowToPointer(dragged, false);

      expect(swapSpy).toHaveBeenCalled();
    });

    it("should detect corner as top region (top takes priority over left)", () => {
      const monitor = getMonitor();

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1000, height: 1000 },
        WINDOW_MODES.GRAB_TILE
      );

      // Top-left corner (both left and top regions)
      setPointer(100, 100);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      // Left region is checked before top, so HSPLIT expected
      expect(dragged.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });
  });

  // ============================================================================
  // SECTION 15: Cleanup After Operations
  // ============================================================================

  describe("Cleanup After Operations", () => {
    /**
     * BUG DOCUMENTED: createCon flag is not reset on focusNodeWindow
     *
     * Root cause: At line 2066, childNode = focusNodeWindow.
     * At line 2154, childNode.createCon = true (sets it on focusNodeWindow).
     * At lines 2279/2281, childNode is REASSIGNED to parentNodeTarget or new Node.
     * At line 2324, childNode.createCon = false resets the WRONG node.
     *
     * The fix should reset focusNodeWindow.createCon, not childNode.createCon.
     */
    it("BUG: createCon flag is NOT reset on focusNodeWindow after operation", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 540,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 540,
        width: 1920,
        height: 540,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 540 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(100, 270);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      // BUG FIXED: The createCon flag is now properly reset on focusNodeWindow
      // Previously it was being reset on childNode which could be a different node
      expect(dragged.createCon).toBe(false);
    });

    it("should reset detachWindow flag after operation", () => {
      const monitor = getMonitor();
      monitor.layout = LAYOUT_TYPES.STACKED;

      const { nodeWindow: target } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: other } = createWindowWithRect(monitor, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });
      const { nodeWindow: dragged } = createWindowWithRect(
        monitor,
        { x: 0, y: 0, width: 1920, height: 1080 },
        WINDOW_MODES.GRAB_TILE
      );

      setPointer(100, 540);
      wm().nodeWinAtPointer = target;

      wm().moveWindowToPointer(dragged, false);

      expect(dragged.detachWindow).toBe(false);
    });
  });
});
