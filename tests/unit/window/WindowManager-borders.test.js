import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowManager, WINDOW_MODES } from "../../../lib/extension/window.js";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
import { Workspace, Rectangle } from "../../mocks/gnome/Meta.js";

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
  let windowManager;
  let mockExtension;
  let mockSettings;
  let mockConfigMgr;
  let workspace0;

  beforeEach(() => {
    // Mock global display and workspace manager
    global.display = {
      get_workspace_manager: vi.fn(),
      get_n_monitors: vi.fn(() => 1),
      get_focus_window: vi.fn(() => null),
      get_current_monitor: vi.fn(() => 0),
      get_current_time: vi.fn(() => 12345),
      get_monitor_geometry: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      get_monitor_neighbor_index: vi.fn(() => -1),
      sort_windows_by_stacking: vi.fn((windows) => windows),
    };

    workspace0 = new Workspace({ index: 0 });

    global.workspace_manager = {
      get_n_workspaces: vi.fn(() => 1),
      get_workspace_by_index: vi.fn((i) => (i === 0 ? workspace0 : new Workspace({ index: i }))),
      get_active_workspace_index: vi.fn(() => 0),
      get_active_workspace: vi.fn(() => workspace0),
    };

    global.display.get_workspace_manager.mockReturnValue(global.workspace_manager);

    global.window_group = {
      contains: vi.fn(() => false),
      add_child: vi.fn(),
      remove_child: vi.fn(),
    };

    global.get_current_time = vi.fn(() => 12345);
    global.get_pointer = vi.fn(() => [960, 540]);

    // Mock settings
    mockSettings = {
      get_boolean: vi.fn((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-on-hover-enabled") return false;
        if (key === "focus-border-toggle") return true;
        if (key === "focus-border-hidden-on-single") return false;
        if (key === "split-border-toggle") return false;
        return false;
      }),
      get_uint: vi.fn((key) => {
        if (key === "window-gap-size") return 4;
        return 0;
      }),
      get_string: vi.fn(() => ""),
      set_boolean: vi.fn(),
      set_uint: vi.fn(),
      set_string: vi.fn(),
    };

    // Mock config manager
    mockConfigMgr = {
      windowProps: {
        overrides: [],
      },
    };

    // Mock extension
    mockExtension = {
      metadata: { version: "1.0.0" },
      settings: mockSettings,
      configMgr: mockConfigMgr,
      keybindings: null,
      theme: {
        loadStylesheet: vi.fn(),
      },
    };

    // Create WindowManager
    windowManager = new WindowManager(mockExtension);
  });

  describe("hideWindowBorders", () => {
    it("should hide borders on all window actors", () => {
      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      const hideActorBorderSpy = vi.spyOn(windowManager, "hideActorBorder");

      windowManager.hideWindowBorders();

      // Should have called hideActorBorder for each window
      expect(hideActorBorderSpy).toHaveBeenCalled();
    });

    it("should remove tab active class from tabbed windows", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.TABBED;

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow.mode = WINDOW_MODES.TILE;

      // Create mock tab
      const mockTab = {
        _destroyed: false,
        get_parent: vi.fn(() => ({ add_child: vi.fn() })),
        remove_style_class_name: vi.fn(),
      };
      nodeWindow.tab = mockTab;

      windowManager.hideWindowBorders();

      expect(mockTab.remove_style_class_name).toHaveBeenCalledWith("window-tabbed-tab-active");
    });
  });

  describe("showWindowBorders", () => {
    it("should apply tiled border class for normal tiled windows", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
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

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      // Add another window so single-window check doesn't apply
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      windowManager.showWindowBorders();

      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-tiled-border");
    });

    it("should apply stacked border class for windows in stacked container", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
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

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.STACKED;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      windowManager.showWindowBorders();

      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-stacked-border");
    });

    it("should apply tabbed border class for windows in tabbed container", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
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

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.TABBED;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow1.tab = {
        add_style_class_name: vi.fn(),
        remove_style_class_name: vi.fn(),
        _destroyed: false,
        get_parent: vi.fn(() => ({})),
      };

      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      windowManager.showWindowBorders();

      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-tabbed-border");
    });

    it("should add tab active class for tabbed windows", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
        wm_class: "TestApp",
      });

      global.display.get_focus_window.mockReturnValue(metaWindow);

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.TABBED;

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow.mode = WINDOW_MODES.TILE;

      const mockTab = {
        add_style_class_name: vi.fn(),
        remove_style_class_name: vi.fn(),
        _destroyed: false,
        get_parent: vi.fn(() => ({})),
      };
      nodeWindow.tab = mockTab;

      windowManager.showWindowBorders();

      expect(mockTab.add_style_class_name).toHaveBeenCalledWith("window-tabbed-tab-active");
    });
  });

  describe("Focus Border Hidden on Single Window", () => {
    it("should skip border when single window on single monitor with setting enabled", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-border-toggle") return true;
        if (key === "focus-border-hidden-on-single") return true;
        return false;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
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

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow.mode = WINDOW_MODES.TILE;

      windowManager.showWindowBorders();

      // Border class should NOT be set for single window with setting enabled
      expect(mockBorder.set_style_class_name).not.toHaveBeenCalledWith("window-tiled-border");
    });

    it("should show border when multiple windows exist", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-border-toggle") return true;
        if (key === "focus-border-hidden-on-single") return true;
        return false;
      });

      const metaWindow1 = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
        wm_class: "TestApp",
      });
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
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

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow1 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow1
      );
      nodeWindow1.mode = WINDOW_MODES.TILE;

      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      windowManager.showWindowBorders();

      // Border class should be set when multiple windows exist
      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-tiled-border");
    });
  });

  describe("Border Settings Integration", () => {
    it("should not show borders when focus-border-toggle is disabled", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-border-toggle") return false;
        return false;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
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

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow.mode = WINDOW_MODES.TILE;

      // Add second window
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      windowManager.showWindowBorders();

      // Should not set border class when disabled
      expect(mockBorder.set_style_class_name).not.toHaveBeenCalledWith("window-tiled-border");
    });

    it("should not show borders when tiling-mode-enabled is disabled", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return false;
        if (key === "focus-border-toggle") return true;
        return false;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
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

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow.mode = WINDOW_MODES.TILE;

      // Add second window
      const metaWindow2 = createMockWindow({
        rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
        workspace: workspace0,
      });
      const nodeWindow2 = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow2
      );
      nodeWindow2.mode = WINDOW_MODES.TILE;

      windowManager.showWindowBorders();

      // Should not set border class when tiling is disabled
      expect(mockBorder.set_style_class_name).not.toHaveBeenCalledWith("window-tiled-border");
    });
  });

  describe("Multi-Monitor Border Behavior", () => {
    it("should show border for single window when multiple monitors exist", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-border-toggle") return true;
        if (key === "focus-border-hidden-on-single") return true;
        return false;
      });
      mockSettings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 0;
        return 0;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
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

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );
      nodeWindow.mode = WINDOW_MODES.TILE;

      windowManager.showWindowBorders();

      // Should show border with multiple monitors even for single window
      expect(mockBorder.set_style_class_name).toHaveBeenCalledWith("window-tiled-border");
    });
  });
});
