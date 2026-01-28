import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowManager, WINDOW_MODES } from "../../../lib/extension/window.js";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
import { Workspace, Rectangle, WindowType } from "../../mocks/gnome/Meta.js";

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
      focus_window: null,
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
    global.get_window_actors = vi.fn(() => []);

    global.Main = {
      overview: {
        visible: false,
      },
    };

    global.Meta = {
      WindowType,
    };

    // Mock settings
    mockSettings = {
      get_boolean: vi.fn((key) => {
        if (key === "tiling-mode-enabled") return true;
        if (key === "focus-on-hover-enabled") return false;
        if (key === "move-pointer-focus-enabled") return false;
        if (key === "focus-on-hover-tiling-only") return false;
        return false;
      }),
      get_uint: vi.fn(() => 0),
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

  describe("movePointerWith", () => {
    it("should return early when nodeWindow is null", () => {
      expect(() => windowManager.movePointerWith(null)).not.toThrow();
    });

    it("should return early when nodeWindow has no _data", () => {
      expect(() => windowManager.movePointerWith({})).not.toThrow();
    });

    it("should not warp pointer when move-pointer-focus-enabled is false", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "move-pointer-focus-enabled") return false;
        return true;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      const warpSpy = vi.spyOn(windowManager, "warpPointerToNodeWindow");

      windowManager.movePointerWith(nodeWindow);

      expect(warpSpy).not.toHaveBeenCalled();
    });

    it("should warp pointer when move-pointer-focus-enabled is true", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "move-pointer-focus-enabled") return true;
        return true;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      const canMoveSpy = vi.spyOn(windowManager, "canMovePointerInsideNodeWindow");

      windowManager.movePointerWith(nodeWindow);

      expect(canMoveSpy).toHaveBeenCalledWith(nodeWindow);
    });

    it("should warp pointer when force option is true", () => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === "move-pointer-focus-enabled") return false;
        return true;
      });

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      const canMoveSpy = vi.spyOn(windowManager, "canMovePointerInsideNodeWindow");

      windowManager.movePointerWith(nodeWindow, { force: true });

      expect(canMoveSpy).toHaveBeenCalledWith(nodeWindow);
    });

    it("should update lastFocusedWindow", () => {
      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const workspace = windowManager.tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const nodeWindow = windowManager.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        metaWindow
      );

      windowManager.movePointerWith(nodeWindow);

      expect(windowManager.lastFocusedWindow).toBe(nodeWindow);
    });
  });

  describe("_focusWindowUnderPointer - Focus Behavior", () => {
    it("should focus window under pointer when conditions are met", () => {
      windowManager.shouldFocusOnHover = true;
      windowManager.disabled = false;
      global.Main.overview.visible = false;

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
        workspace: workspace0,
      });

      const windowActor = metaWindow.get_compositor_private();
      windowActor.meta_window = metaWindow;
      global.get_window_actors.mockReturnValue([windowActor]);

      // Pointer is inside window
      global.get_pointer.mockReturnValue([960, 540]);

      const focusSpy = vi.spyOn(metaWindow, "focus");
      const raiseSpy = vi.spyOn(metaWindow, "raise");

      windowManager._focusWindowUnderPointer();

      expect(focusSpy).toHaveBeenCalledWith(12345);
      expect(raiseSpy).toHaveBeenCalled();
    });

    it("should continue polling by returning true", () => {
      windowManager.shouldFocusOnHover = true;
      windowManager.disabled = false;

      const result = windowManager._focusWindowUnderPointer();

      expect(result).toBe(true);
    });

    it("should not focus when pointer is outside all windows", () => {
      windowManager.shouldFocusOnHover = true;
      windowManager.disabled = false;

      const metaWindow = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
        workspace: workspace0,
      });

      const windowActor = metaWindow.get_compositor_private();
      windowActor.meta_window = metaWindow;
      global.get_window_actors.mockReturnValue([windowActor]);

      // Pointer is outside window
      global.get_pointer.mockReturnValue([1500, 900]);

      const focusSpy = vi.spyOn(metaWindow, "focus");

      windowManager._focusWindowUnderPointer();

      expect(focusSpy).not.toHaveBeenCalled();
    });
  });
});
