import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Workspace, WindowType } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager lifecycle tests
 *
 * Tests for window lifecycle management including:
 * - trackWindow(): Adding windows to the tree
 * - windowDestroy(): Removing windows and cleanup
 * - minimizedWindow(): Minimize state checking
 * - postProcessWindow(): Post-creation processing
 */
describe("WindowManager - Window Lifecycle", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // Convenience accessor for tests
  const wm = () => ctx.windowManager;

  describe("minimizedWindow", () => {
    it("should return false for non-minimized window", () => {
      const metaWindow = createMockWindow({ minimized: false });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const result = wm().minimizedWindow(nodeWindow);

      expect(result).toBe(false);
    });

    it("should return true for minimized window", () => {
      const metaWindow = createMockWindow({ minimized: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const result = wm().minimizedWindow(nodeWindow);

      expect(result).toBe(true);
    });
  });

  describe("postProcessWindow", () => {
    it("does not center or warp the pointer for a regular window (forge-f081)", () => {
      const metaWindow = createMockWindow({ title: "Regular Window" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const movePointerSpy = vi.spyOn(wm(), "movePointerWith");
      const moveCenterSpy = vi.spyOn(wm(), "moveCenter");

      wm().postProcessWindow(nodeWindow);

      // The old movePointerWith(metaWindow) call was a dead no-op (wrong arg type)
      // and has been removed; a regular window is left for the focus path to warp.
      expect(moveCenterSpy).not.toHaveBeenCalled();
      expect(movePointerSpy).not.toHaveBeenCalled();
    });

    it("should center and activate preferences window", () => {
      wm().prefsTitle = "Forge Preferences";
      const metaWindow = createMockWindow({ title: "Forge Preferences" });

      const mockWorkspace = new Workspace({ index: 0 });
      metaWindow._workspace = mockWorkspace;
      mockWorkspace.activate_with_focus = vi.fn();

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const moveCenterSpy = vi.spyOn(wm(), "moveCenter");

      wm().postProcessWindow(nodeWindow);

      expect(mockWorkspace.activate_with_focus).toHaveBeenCalledWith(metaWindow, expect.anything());
      expect(moveCenterSpy).toHaveBeenCalledWith(metaWindow);
    });

    it("should not move pointer for preferences window", () => {
      wm().prefsTitle = "Forge Preferences";
      const metaWindow = createMockWindow({ title: "Forge Preferences" });

      const mockWorkspace = new Workspace({ index: 0 });
      metaWindow._workspace = mockWorkspace;
      mockWorkspace.activate_with_focus = vi.fn();

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const movePointerSpy = vi.spyOn(wm(), "movePointerWith");

      wm().postProcessWindow(nodeWindow);

      expect(movePointerSpy).not.toHaveBeenCalled();
    });
  });

  describe("trackWindow", () => {
    it("should not track invalid window types", () => {
      const metaWindow = createMockWindow({ window_type: WindowType.MENU });
      const treeCreateSpy = vi.spyOn(ctx.tree, "createNode");

      wm().trackWindow(null, metaWindow);

      // Should not create node for invalid window type
      expect(treeCreateSpy).not.toHaveBeenCalled();
    });

    it("should not track duplicate windows", () => {
      const metaWindow = createMockWindow();
      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create window first time
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const treeCreateSpy = vi.spyOn(ctx.tree, "createNode");

      // Try to track same window again
      wm().trackWindow(null, metaWindow);

      // Should not create duplicate node
      expect(treeCreateSpy).not.toHaveBeenCalled();
    });

    it("should track valid NORMAL windows", () => {
      const metaWindow = createMockWindow({
        window_type: WindowType.NORMAL,
        title: "Test Window",
      });

      const initialNodeCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm().trackWindow(null, metaWindow);

      const finalNodeCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;
      expect(finalNodeCount).toBe(initialNodeCount + 1);
    });

    it("should track valid DIALOG windows", () => {
      const metaWindow = createMockWindow({
        window_type: WindowType.DIALOG,
        title: "Dialog Window",
      });

      const initialNodeCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm().trackWindow(null, metaWindow);

      const finalNodeCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;
      expect(finalNodeCount).toBe(initialNodeCount + 1);
    });

    it("should track valid MODAL_DIALOG windows", () => {
      const metaWindow = createMockWindow({
        window_type: WindowType.MODAL_DIALOG,
        title: "Modal Dialog",
      });

      const initialNodeCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm().trackWindow(null, metaWindow);

      const finalNodeCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;
      expect(finalNodeCount).toBe(initialNodeCount + 1);
    });

    it("should create window in FLOAT mode by default", () => {
      const metaWindow = createMockWindow();

      wm().trackWindow(null, metaWindow);

      const nodeWindow = wm().findNodeWindow(metaWindow);
      expect(nodeWindow).not.toBeNull();
      expect(nodeWindow.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should attach window to current monitor/workspace", () => {
      const metaWindow = createMockWindow();

      wm().trackWindow(null, metaWindow);

      const nodeWindow = wm().findNodeWindow(metaWindow);
      expect(nodeWindow).not.toBeNull();

      // Should be attached to workspace 0, monitor 0
      const { monitor } = getWorkspaceAndMonitor(ctx);
      expect(monitor.contains(nodeWindow)).toBe(true);
    });

    it("should mark window for first render", () => {
      const metaWindow = createMockWindow();

      wm().trackWindow(null, metaWindow);

      expect(metaWindow.firstRender).toBe(true);
    });
  });

  describe("windowDestroy", () => {
    it("should remove borders from actor", () => {
      const metaWindow = createMockWindow();
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const actor = metaWindow.get_compositor_private();
      actor.border = { hide: vi.fn() };
      actor.splitBorder = { hide: vi.fn() };

      const removeChildSpy = vi.spyOn(ctx.windowGroup, "remove_child");

      wm().windowDestroy(actor);

      expect(removeChildSpy).toHaveBeenCalledWith(actor.border);
      expect(removeChildSpy).toHaveBeenCalledWith(actor.splitBorder);
      expect(actor.border.hide).toHaveBeenCalled();
      expect(actor.splitBorder.hide).toHaveBeenCalled();
    });

    it("should remove window node from tree", () => {
      const metaWindow = createMockWindow();
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const actor = metaWindow.get_compositor_private();
      actor.nodeWindow = nodeWindow;

      // Mock findNodeByActor to return our node
      vi.spyOn(ctx.tree, "findNodeByActor").mockReturnValue(nodeWindow);

      const initialNodeCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm().windowDestroy(actor);

      const finalNodeCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;
      expect(finalNodeCount).toBe(initialNodeCount - 1);
    });

    it("should not remove non-window nodes", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const actor = { border: null, splitBorder: null };

      // Mock findNodeByActor to return monitor (non-window node)
      vi.spyOn(ctx.tree, "findNodeByActor").mockReturnValue(monitor);

      const initialNodeCount = ctx.tree.getNodeByType(NODE_TYPES.MONITOR).length;

      wm().windowDestroy(actor);

      const finalNodeCount = ctx.tree.getNodeByType(NODE_TYPES.MONITOR).length;
      // Monitor should not be removed
      expect(finalNodeCount).toBe(initialNodeCount);
    });

    it("should remove float override for destroyed window", () => {
      const metaWindow = createMockWindow();
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const actor = metaWindow.get_compositor_private();
      actor.nodeWindow = nodeWindow;

      vi.spyOn(ctx.tree, "findNodeByActor").mockReturnValue(nodeWindow);
      const removeOverrideSpy = vi.spyOn(wm(), "removeFloatOverride");

      wm().windowDestroy(actor);

      expect(removeOverrideSpy).toHaveBeenCalledWith(metaWindow, true);
    });

    it("should queue render event after destruction", () => {
      const metaWindow = createMockWindow();
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const actor = metaWindow.get_compositor_private();
      vi.spyOn(ctx.tree, "findNodeByActor").mockReturnValue(nodeWindow);
      const queueEventSpy = vi.spyOn(wm(), "queueEvent");

      wm().windowDestroy(actor);

      expect(queueEventSpy).toHaveBeenCalledWith({
        name: "window-destroy",
        callback: expect.any(Function),
      });
    });
  });

  describe("Window Lifecycle Integration", () => {
    it("should track and then destroy window", () => {
      const metaWindow = createMockWindow({ title: "Test Window" });

      // Track window
      wm().trackWindow(null, metaWindow);

      let nodeWindow = wm().findNodeWindow(metaWindow);
      expect(nodeWindow).not.toBeNull();
      expect(nodeWindow.mode).toBe(WINDOW_MODES.FLOAT);

      // Destroy window
      const actor = metaWindow.get_compositor_private();
      vi.spyOn(ctx.tree, "findNodeByActor").mockReturnValue(nodeWindow);
      wm().windowDestroy(actor);

      // Window should be removed from tree
      nodeWindow = wm().findNodeWindow(metaWindow);
      expect(nodeWindow).toBeNull();
    });

    it("should handle window minimize state throughout lifecycle", () => {
      const metaWindow = createMockWindow({ minimized: false });

      // Track window
      wm().trackWindow(null, metaWindow);
      let nodeWindow = wm().findNodeWindow(metaWindow);

      // Initially not minimized
      expect(wm().minimizedWindow(nodeWindow)).toBe(false);

      // Minimize window
      metaWindow.minimized = true;
      expect(wm().minimizedWindow(nodeWindow)).toBe(true);

      // Unminimize window
      metaWindow.minimized = false;
      expect(wm().minimizedWindow(nodeWindow)).toBe(false);
    });

    it("post-processes a tracked regular window without warping the pointer", () => {
      const metaWindow = createMockWindow({ title: "Regular Window" });
      const movePointerSpy = vi.spyOn(wm(), "movePointerWith");

      // Track window
      wm().trackWindow(null, metaWindow);
      const nodeWindow = wm().findNodeWindow(metaWindow);

      // Post-process — the dead movePointerWith(metaWindow) call was removed (forge-f081).
      wm().postProcessWindow(nodeWindow);

      expect(nodeWindow).toBeTruthy();
      expect(movePointerSpy).not.toHaveBeenCalled();
    });
  });

  describe("_validWindow", () => {
    it("should accept NORMAL window type", () => {
      const metaWindow = createMockWindow({ window_type: WindowType.NORMAL });
      expect(wm()._validWindow(metaWindow)).toBe(true);
    });

    it("should accept DIALOG window type", () => {
      const metaWindow = createMockWindow({ window_type: WindowType.DIALOG });
      expect(wm()._validWindow(metaWindow)).toBe(true);
    });

    it("should accept MODAL_DIALOG window type", () => {
      const metaWindow = createMockWindow({ window_type: WindowType.MODAL_DIALOG });
      expect(wm()._validWindow(metaWindow)).toBe(true);
    });

    it("should reject UTILITY window type", () => {
      const metaWindow = createMockWindow({ window_type: WindowType.UTILITY });
      expect(wm()._validWindow(metaWindow)).toBe(false);
    });

    it("should reject POPUP_MENU window type", () => {
      const metaWindow = createMockWindow({ window_type: WindowType.POPUP_MENU });
      expect(wm()._validWindow(metaWindow)).toBe(false);
    });

    it("should reject DROPDOWN_MENU window type", () => {
      const metaWindow = createMockWindow({ window_type: WindowType.DROPDOWN_MENU });
      expect(wm()._validWindow(metaWindow)).toBe(false);
    });

    it("should reject TOOLTIP window type", () => {
      const metaWindow = createMockWindow({ window_type: WindowType.TOOLTIP });
      expect(wm()._validWindow(metaWindow)).toBe(false);
    });

    it("should reject xwaylandvideobridge windows", () => {
      const metaWindow = createMockWindow({
        window_type: WindowType.NORMAL,
        wm_class: "Xwaylandvideobridge",
      });
      expect(wm()._validWindow(metaWindow)).toBe(false);
    });

    it("should reject ddterm windows", () => {
      const metaWindow = createMockWindow({
        window_type: WindowType.NORMAL,
        wm_class: "com.github.amezin.ddterm",
      });
      expect(wm()._validWindow(metaWindow)).toBe(false);
    });

    it("should reject DESKTOP window type", () => {
      const metaWindow = createMockWindow({ window_type: WindowType.DESKTOP });
      expect(wm()._validWindow(metaWindow)).toBe(false);
    });
  });
});
