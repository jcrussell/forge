import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
import { createWindowManagerFixture, getWorkspaceAndMonitor } from "../../mocks/helpers/index.js";
import { Rectangle } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager border and focus indicator tests
 *
 * Tests for window border behaviors including:
 * - showWindowBorders(): Display border on focused window
 * - hideWindowBorders(): Remove borders from all windows
 * - Focus border visibility settings
 * - Single window border hiding
 * - Stacked/tabbed container borders
 * - Floating window borders
 */
describe("WindowManager - Borders and Focus Indicators", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "focus-border-toggle": true,
        "focus-border-hidden-on-single": false,
        "split-border-toggle": false,
        "window-gap-size": 4,
      },
    });
  });

  // Convenience accessor
  const wm = () => ctx.windowManager;

  describe("hideWindowBorders", () => {
    it("should hide borders on all window actors", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;

      const hideActorBorderSpy = vi.spyOn(wm(), "hideActorBorder");

      wm().hideWindowBorders();

      // Should have called hideActorBorder for each window
      expect(hideActorBorderSpy).toHaveBeenCalled();
    });

    it("should remove tab active class from tabbed windows", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: ctx.workspaces[0],
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.TABBED;

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.mode = WINDOW_MODES.TILE;

      // Create mock tab
      const mockTab = {
        _destroyed: false,
        get_parent: vi.fn(() => ({ add_child: vi.fn() })),
        remove_style_class_name: vi.fn(),
      };
      nodeWindow.tab = mockTab;

      wm().hideWindowBorders();

      expect(mockTab.remove_style_class_name).toHaveBeenCalledWith("window-tabbed-tab-active");
    });
  });

  describe("showWindowBorders", () => {
    it("should apply tiled border class for normal tiled windows", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp",
      });

      const mockBorder = {
        set_style_class_name: vi.fn(),
        add_style_class_name: vi.fn(),
        set_size: vi.fn(),
        set_position: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      const windowActor = metaWindow.get_compositor_private();
      windowActor.border = mockBorder;

      global.display.get_focus_window.mockReturnValue(metaWindow);

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow1.mode = WINDOW_MODES.TILE;

      // Add another window so single-window check doesn't apply
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
      });
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;

      wm().showWindowBorders();

      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-tiled-border");
    });

    it("should apply stacked border class for windows in stacked container", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp",
      });

      const mockBorder = {
        set_style_class_name: vi.fn(),
        add_style_class_name: vi.fn(),
        set_size: vi.fn(),
        set_position: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      const windowActor = metaWindow.get_compositor_private();
      windowActor.border = mockBorder;

      global.display.get_focus_window.mockReturnValue(metaWindow);

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.STACKED;

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: ctx.workspaces[0],
      });
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;

      wm().showWindowBorders();

      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-stacked-border");
    });

    it("should apply tabbed border class for windows in tabbed container", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp",
      });

      const mockBorder = {
        set_style_class_name: vi.fn(),
        add_style_class_name: vi.fn(),
        set_size: vi.fn(),
        set_position: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      const windowActor = metaWindow.get_compositor_private();
      windowActor.border = mockBorder;

      global.display.get_focus_window.mockReturnValue(metaWindow);

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.TABBED;

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.tab = {
        add_style_class_name: vi.fn(),
        remove_style_class_name: vi.fn(),
        _destroyed: false,
        get_parent: vi.fn(() => ({})),
      };

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: ctx.workspaces[0],
      });
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;

      wm().showWindowBorders();

      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-tabbed-border");
    });

    it("should add tab active class for tabbed windows", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp",
      });

      global.display.get_focus_window.mockReturnValue(metaWindow);

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.TABBED;

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.mode = WINDOW_MODES.TILE;

      const mockTab = {
        add_style_class_name: vi.fn(),
        remove_style_class_name: vi.fn(),
        _destroyed: false,
        get_parent: vi.fn(() => ({})),
      };
      nodeWindow.tab = mockTab;

      wm().showWindowBorders();

      expect(mockTab.add_style_class_name).toHaveBeenCalledWith("window-tabbed-tab-active");
    });
  });

  describe("Focus Border Hidden on Single Window", () => {
    it("should skip border when single window on single monitor with setting enabled", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-border-toggle") return true;
        if (key === "focus-border-hidden-on-single") return true;
        return false;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp",
      });

      const mockBorder = {
        set_style_class_name: vi.fn(),
        add_style_class_name: vi.fn(),
        set_size: vi.fn(),
        set_position: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      const windowActor = metaWindow.get_compositor_private();
      windowActor.border = mockBorder;

      global.display.get_focus_window.mockReturnValue(metaWindow);
      global.display.get_n_monitors.mockReturnValue(1);

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.mode = WINDOW_MODES.TILE;

      wm().showWindowBorders();

      // Border class should NOT be set for single window with setting enabled
      expect(mockBorder.set_style_class_name).not.toHaveBeenCalledWith("window-tiled-border");
    });

    it("should show border when multiple windows exist", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-border-toggle") return true;
        if (key === "focus-border-hidden-on-single") return true;
        return false;
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp",
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp2",
      });

      const mockBorder = {
        set_style_class_name: vi.fn(),
        add_style_class_name: vi.fn(),
        set_size: vi.fn(),
        set_position: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      const windowActor = metaWindow1.get_compositor_private();
      windowActor.border = mockBorder;

      global.display.get_focus_window.mockReturnValue(metaWindow1);
      global.display.get_n_monitors.mockReturnValue(1);

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;

      wm().showWindowBorders();

      // Border class should be set when multiple windows exist
      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-tiled-border");
    });
  });

  describe("Border Settings Integration", () => {
    it("should not show borders when focus-border-toggle is disabled", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-border-toggle") return false;
        return false;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp",
      });

      const mockBorder = {
        set_style_class_name: vi.fn(),
        add_style_class_name: vi.fn(),
        set_size: vi.fn(),
        set_position: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      const windowActor = metaWindow.get_compositor_private();
      windowActor.border = mockBorder;

      global.display.get_focus_window.mockReturnValue(metaWindow);

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.mode = WINDOW_MODES.TILE;

      // Add second window
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
      });
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;

      wm().showWindowBorders();

      // Should not set border class when disabled
      expect(mockBorder.set_style_class_name).not.toHaveBeenCalledWith("window-tiled-border");
    });

    it("should not show borders when tiling-mode-enabled is disabled", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return false;
        if (key === "focus-border-toggle") return true;
        return false;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp",
      });

      const mockBorder = {
        set_style_class_name: vi.fn(),
        add_style_class_name: vi.fn(),
        set_size: vi.fn(),
        set_position: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      const windowActor = metaWindow.get_compositor_private();
      windowActor.border = mockBorder;

      global.display.get_focus_window.mockReturnValue(metaWindow);

      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.mode = WINDOW_MODES.TILE;

      // Add second window
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
      });
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      nodeWindow2.mode = WINDOW_MODES.TILE;

      wm().showWindowBorders();

      // Should not set border class when tiling is disabled
      expect(mockBorder.set_style_class_name).not.toHaveBeenCalledWith("window-tiled-border");
    });
  });

  describe("Multi-Monitor Border Behavior", () => {
    it("should show border for single window when multiple monitors exist", () => {
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-border-toggle") return true;
        if (key === "focus-border-hidden-on-single") return true;
        return false;
      });
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 0;
        return 0;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: ctx.workspaces[0],
        wm_class: "TestApp",
      });

      const mockBorder = {
        set_style_class_name: vi.fn(),
        add_style_class_name: vi.fn(),
        set_size: vi.fn(),
        set_position: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      };
      const windowActor = metaWindow.get_compositor_private();
      windowActor.border = mockBorder;

      global.display.get_focus_window.mockReturnValue(metaWindow);
      global.display.get_n_monitors.mockReturnValue(2); // Multiple monitors

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.mode = WINDOW_MODES.TILE;

      wm().showWindowBorders();

      // Should show border with multiple monitors even for single window
      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-tiled-border");
    });
  });
});
