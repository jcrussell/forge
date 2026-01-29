import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
import { createWindowManagerFixture, getWorkspaceAndMonitor } from "../../mocks/helpers/index.js";
import { WindowType } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager workspace management tests
 *
 * Tests for workspace-related operations including:
 * - getWindowsOnWorkspace(): Get windows on a specific workspace
 * - isActiveWindowWorkspaceTiled(): Check if window's workspace allows tiling
 * - isCurrentWorkspaceTiled(): Check if current workspace allows tiling
 * - trackCurrentMonWs(): Track current monitor/workspace
 * - trackCurrentWindows(): Sync tree with current windows
 */
describe("WindowManager - Workspace Management", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: {
        workspaceManager: { workspaceCount: 3 },
      },
    });
  });

  // Convenience accessors
  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];
  const workspace1 = () => ctx.workspaces[1];
  const workspace2 = () => ctx.workspaces[2];

  describe("getWindowsOnWorkspace", () => {
    it("should return windows on specified workspace", () => {
      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      const metaWindow2 = createMockWindow({ id: 2, workspace: workspace0() });

      const wsNode = ctx.tree.nodeWorkpaces[0];
      const monitor = wsNode.getNodeByType(NODE_TYPES.MONITOR)[0];

      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      const windows = wm().getWindowsOnWorkspace(0);

      expect(windows).toHaveLength(2);
      expect(windows[0].nodeValue).toBe(metaWindow1);
      expect(windows[1].nodeValue).toBe(metaWindow2);
    });

    it("should return empty array for workspace with no windows", () => {
      const windows = wm().getWindowsOnWorkspace(0);

      expect(windows).toHaveLength(0);
    });

    it("should return windows only from specified workspace", () => {
      // Add window to workspace 0
      const wsNode0 = ctx.tree.nodeWorkpaces[0];
      const monitor0 = wsNode0.getNodeByType(NODE_TYPES.MONITOR)[0];
      const metaWindow1 = createMockWindow({ id: 1, workspace: workspace0() });
      ctx.tree.createNode(monitor0.nodeValue, NODE_TYPES.WINDOW, metaWindow1);

      // Add window to workspace 1
      const wsNode1 = ctx.tree.nodeWorkpaces[1];
      const monitor1 = wsNode1.getNodeByType(NODE_TYPES.MONITOR)[0];
      const metaWindow2 = createMockWindow({ id: 2, workspace: workspace1() });
      ctx.tree.createNode(monitor1.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      const windows0 = wm().getWindowsOnWorkspace(0);
      const windows1 = wm().getWindowsOnWorkspace(1);

      expect(windows0).toHaveLength(1);
      expect(windows1).toHaveLength(1);
      expect(windows0[0].nodeValue).toBe(metaWindow1);
      expect(windows1[0].nodeValue).toBe(metaWindow2);
    });

    it("should include all window types on workspace", () => {
      const wsNode = ctx.tree.nodeWorkpaces[0];
      const monitor = wsNode.getNodeByType(NODE_TYPES.MONITOR)[0];

      const normalWindow = createMockWindow({ id: 1, window_type: WindowType.NORMAL });
      const dialogWindow = createMockWindow({ id: 2, window_type: WindowType.DIALOG });

      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, normalWindow);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dialogWindow);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.FLOAT;

      const windows = wm().getWindowsOnWorkspace(0);

      expect(windows).toHaveLength(2);
    });

    it("should include minimized windows", () => {
      const wsNode = ctx.tree.nodeWorkpaces[0];
      const monitor = wsNode.getNodeByType(NODE_TYPES.MONITOR)[0];

      const metaWindow1 = createMockWindow({ id: 1, minimized: false });
      const metaWindow2 = createMockWindow({ id: 2, minimized: true });

      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      const windows = wm().getWindowsOnWorkspace(0);

      expect(windows).toHaveLength(2);
    });
  });

  describe("isActiveWindowWorkspaceTiled", () => {
    it("should return true when window workspace is not skipped", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "1,2";
        return "";
      });

      const metaWindow = createMockWindow({ workspace: workspace0() });

      const result = wm().isActiveWindowWorkspaceTiled(metaWindow);

      expect(result).toBe(true);
    });

    it("should return false when window workspace is skipped", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "0,2";
        return "";
      });

      const metaWindow = createMockWindow({ workspace: workspace0() });

      const result = wm().isActiveWindowWorkspaceTiled(metaWindow);

      expect(result).toBe(false);
    });

    it("should handle empty skip list", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "";
        return "";
      });

      const metaWindow = createMockWindow({ workspace: workspace0() });

      const result = wm().isActiveWindowWorkspaceTiled(metaWindow);

      expect(result).toBe(true);
    });

    it("should handle single workspace in skip list", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "1";
        return "";
      });

      const metaWindow0 = createMockWindow({ workspace: workspace0() });
      const metaWindow1 = createMockWindow({ workspace: workspace1() });

      expect(wm().isActiveWindowWorkspaceTiled(metaWindow0)).toBe(true);
      expect(wm().isActiveWindowWorkspaceTiled(metaWindow1)).toBe(false);
    });

    it("should handle multiple workspaces in skip list", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "0,1,2";
        return "";
      });

      const metaWindow0 = createMockWindow({ workspace: workspace0() });
      const metaWindow1 = createMockWindow({ workspace: workspace1() });
      const metaWindow2 = createMockWindow({ workspace: workspace2() });

      expect(wm().isActiveWindowWorkspaceTiled(metaWindow0)).toBe(false);
      expect(wm().isActiveWindowWorkspaceTiled(metaWindow1)).toBe(false);
      expect(wm().isActiveWindowWorkspaceTiled(metaWindow2)).toBe(false);
    });

    it("should handle whitespace in skip list", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return " 0 , 1 , 2 ";
        return "";
      });

      const metaWindow = createMockWindow({ workspace: workspace0() });

      const result = wm().isActiveWindowWorkspaceTiled(metaWindow);

      expect(result).toBe(false);
    });

    it("should return true for window without workspace", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "0";
        return "";
      });

      const metaWindow = createMockWindow({ workspace: null });

      const result = wm().isActiveWindowWorkspaceTiled(metaWindow);

      // Window without workspace is not restricted
      expect(result).toBe(true);
    });
  });

  describe("isCurrentWorkspaceTiled", () => {
    it("should return true when current workspace is not skipped", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "1,2";
        return "";
      });
      global.workspace_manager.get_active_workspace_index.mockReturnValue(0);

      const result = wm().isCurrentWorkspaceTiled();

      expect(result).toBe(true);
    });

    it("should return false when current workspace is skipped", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "0,2";
        return "";
      });
      global.workspace_manager.get_active_workspace_index.mockReturnValue(0);

      const result = wm().isCurrentWorkspaceTiled();

      expect(result).toBe(false);
    });

    it("should handle empty skip list", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "";
        return "";
      });

      const result = wm().isCurrentWorkspaceTiled();

      expect(result).toBe(true);
    });

    it("should check different workspaces correctly", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "1";
        return "";
      });

      // Workspace 0
      global.workspace_manager.get_active_workspace_index.mockReturnValue(0);
      expect(wm().isCurrentWorkspaceTiled()).toBe(true);

      // Workspace 1 (skipped)
      global.workspace_manager.get_active_workspace_index.mockReturnValue(1);
      expect(wm().isCurrentWorkspaceTiled()).toBe(false);

      // Workspace 2
      global.workspace_manager.get_active_workspace_index.mockReturnValue(2);
      expect(wm().isCurrentWorkspaceTiled()).toBe(true);
    });

    it("should handle whitespace in skip list", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return " 0 , 2 ";
        return "";
      });
      global.workspace_manager.get_active_workspace_index.mockReturnValue(0);

      const result = wm().isCurrentWorkspaceTiled();

      expect(result).toBe(false);
    });
  });

  describe("trackCurrentMonWs", () => {
    it("should track monitor and workspace for focused window", () => {
      const metaWindow = createMockWindow({ workspace: workspace0(), monitor: 0 });
      global.display.get_focus_window.mockReturnValue(metaWindow);
      global.display.get_current_monitor.mockReturnValue(0);

      expect(() => wm().trackCurrentMonWs()).not.toThrow();
    });

    it("should handle window on different workspace", () => {
      const metaWindow = createMockWindow({ workspace: workspace1(), monitor: 0 });
      metaWindow._monitor = 0;

      global.display.get_focus_window.mockReturnValue(metaWindow);
      global.display.get_current_monitor.mockReturnValue(0);
      global.workspace_manager.get_active_workspace_index.mockReturnValue(0);

      expect(() => wm().trackCurrentMonWs()).not.toThrow();
    });
  });

  describe("trackCurrentWindows", () => {
    it("should track all windows across workspaces", () => {
      // Create windows on different workspaces
      const window1 = createMockWindow({ id: 1, workspace: workspace0() });
      const window2 = createMockWindow({ id: 2, workspace: workspace1() });

      // Mock windowsAllWorkspaces getter
      Object.defineProperty(wm(), "windowsAllWorkspaces", {
        get: vi.fn(() => [window1, window2]),
        configurable: true,
      });

      const trackSpy = vi.spyOn(wm(), "trackWindow");

      wm().trackCurrentWindows();

      // Should track both windows
      expect(trackSpy).toHaveBeenCalledTimes(2);
      expect(trackSpy).toHaveBeenCalledWith(global.display, window1);
      expect(trackSpy).toHaveBeenCalledWith(global.display, window2);
    });

    it("should reset attach node before tracking", () => {
      Object.defineProperty(wm(), "windowsAllWorkspaces", {
        get: vi.fn(() => []),
        configurable: true,
      });

      ctx.tree.attachNode = { some: "node" };

      wm().trackCurrentWindows();

      expect(ctx.tree.attachNode).toBeNull();
    });

    it("should call updateMetaWorkspaceMonitor for each window", () => {
      const window1 = createMockWindow({ id: 1, monitor: 0 });

      Object.defineProperty(wm(), "windowsAllWorkspaces", {
        get: vi.fn(() => [window1]),
        configurable: true,
      });

      const updateSpy = vi.spyOn(wm(), "updateMetaWorkspaceMonitor");

      wm().trackCurrentWindows();

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith("track-current-windows", 0, window1);
    });

    it("should update decoration layout after tracking", () => {
      Object.defineProperty(wm(), "windowsAllWorkspaces", {
        get: vi.fn(() => []),
        configurable: true,
      });

      const updateDecoSpy = vi.spyOn(wm(), "updateDecorationLayout");

      wm().trackCurrentWindows();

      expect(updateDecoSpy).toHaveBeenCalled();
    });
  });

  describe("Workspace Integration", () => {
    it("should correctly identify tiled vs skipped workspaces", () => {
      ctx.settings.get_string.mockImplementation((key) => {
        if (key === "workspace-skip-tile") return "1";
        return "";
      });

      // Workspace 0 should be tiled
      global.workspace_manager.get_active_workspace_index.mockReturnValue(0);
      expect(wm().isCurrentWorkspaceTiled()).toBe(true);

      // Workspace 1 should be skipped (floating)
      global.workspace_manager.get_active_workspace_index.mockReturnValue(1);
      expect(wm().isCurrentWorkspaceTiled()).toBe(false);
    });

    it("should handle workspace with mixed window modes", () => {
      const wsNode = ctx.tree.nodeWorkpaces[0];
      const monitor = wsNode.getNodeByType(NODE_TYPES.MONITOR)[0];

      const tiledWindow = createMockWindow({ id: 1 });
      const floatWindow = createMockWindow({ id: 2 });

      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, tiledWindow);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, floatWindow);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.FLOAT;

      const windows = wm().getWindowsOnWorkspace(0);

      // Should return all windows regardless of mode
      expect(windows).toHaveLength(2);
    });

    it("should track windows across multiple monitors", () => {
      global.display.get_n_monitors.mockReturnValue(2);

      const window1 = createMockWindow({ id: 1, monitor: 0, workspace: workspace0() });
      const window2 = createMockWindow({ id: 2, monitor: 1, workspace: workspace0() });

      Object.defineProperty(wm(), "windowsAllWorkspaces", {
        get: vi.fn(() => [window1, window2]),
        configurable: true,
      });

      const trackSpy = vi.spyOn(wm(), "trackWindow");

      wm().trackCurrentWindows();

      // Should track windows on both monitors
      expect(trackSpy).toHaveBeenCalledTimes(2);
    });
  });
});
