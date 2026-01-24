import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowManager, WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";
import { WindowType, Workspace, Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Bug #311: Tall monitor tiling shows wrong orientation
 *
 * Problem: On a 9:16 portrait monitor, the drag preview shows vertical tiling
 * but the actual result is horizontal tiling. The orientation detection works
 * at monitor level but fails for nested container splits.
 *
 * Root Cause: determineSplitLayout() uses monitor geometry, but when splitting
 * within an existing container, the split direction should use the available
 * space dimensions instead.
 */
describe("Bug #311: Portrait monitor split orientation", () => {
  let windowManager;
  let mockExtension;
  let mockSettings;
  let mockConfigMgr;

  beforeEach(() => {
    // Mock global
    global.display = {
      get_workspace_manager: vi.fn(),
      get_n_monitors: vi.fn(() => 1),
      get_focus_window: vi.fn(() => null),
      get_current_monitor: vi.fn(() => 0),
      get_current_time: vi.fn(() => 12345),
      // Default to portrait monitor (height > width)
      get_monitor_geometry: vi.fn(() => ({ x: 0, y: 0, width: 1080, height: 1920 })),
    };

    const workspace0 = new Workspace({ index: 0 });

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

    // Mock settings
    mockSettings = {
      get_boolean: vi.fn((key) => {
        if (key === "focus-on-hover-enabled") return false;
        if (key === "tiling-mode-enabled") return true;
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

  describe("determineSplitLayout for portrait monitors", () => {
    it("should use VSPLIT for portrait monitors (height > width)", () => {
      // Monitor is 1080x1920 (portrait)
      global.display.get_monitor_geometry.mockReturnValue({
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
      });

      const layout = windowManager.determineSplitLayout();

      expect(layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should use HSPLIT for landscape monitors (width > height)", () => {
      // Monitor is 1920x1080 (landscape)
      global.display.get_monitor_geometry.mockReturnValue({
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });

      const layout = windowManager.determineSplitLayout();

      expect(layout).toBe(LAYOUT_TYPES.HSPLIT);
    });
  });

  describe("determineSplitLayoutForRect", () => {
    it("should use VSPLIT for portrait rect (height > width)", () => {
      const rect = { x: 0, y: 0, width: 400, height: 800 };

      const layout = windowManager.determineSplitLayoutForRect(rect);

      expect(layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should use HSPLIT for landscape rect (width > height)", () => {
      const rect = { x: 0, y: 0, width: 800, height: 400 };

      const layout = windowManager.determineSplitLayoutForRect(rect);

      expect(layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should use HSPLIT for square rect", () => {
      const rect = { x: 0, y: 0, width: 500, height: 500 };

      const layout = windowManager.determineSplitLayoutForRect(rect);

      // Default to HSPLIT for equal dimensions
      expect(layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should fall back to determineSplitLayout for null rect", () => {
      // Portrait monitor
      global.display.get_monitor_geometry.mockReturnValue({
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
      });

      const layout = windowManager.determineSplitLayoutForRect(null);

      // Falls back to monitor-based detection
      expect(layout).toBe(LAYOUT_TYPES.VSPLIT);
    });
  });

  describe("Nested container splits on portrait monitor", () => {
    it("should detect available space orientation for nested splits", () => {
      // On a portrait monitor, after one vertical split,
      // each half is still taller than wide
      // The next split should also be VSPLIT

      // Portrait monitor
      global.display.get_monitor_geometry.mockReturnValue({
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
      });

      // After one VSPLIT, each half is 1080x960 (still portrait-ish)
      // Actually, each half would be 1080 wide x 960 tall
      // 1080 > 960, so it's landscape now
      const halfRect = { x: 0, y: 0, width: 1080, height: 960 };

      // This should be HSPLIT because width > height
      const layout = windowManager.determineSplitLayoutForRect(halfRect);

      expect(layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should handle deeply nested container orientation", () => {
      // After multiple splits, a small container might have different aspect ratio

      // Small tall container
      const tallRect = { x: 0, y: 0, width: 200, height: 600 };
      expect(windowManager.determineSplitLayoutForRect(tallRect)).toBe(LAYOUT_TYPES.VSPLIT);

      // Small wide container
      const wideRect = { x: 0, y: 0, width: 600, height: 200 };
      expect(windowManager.determineSplitLayoutForRect(wideRect)).toBe(LAYOUT_TYPES.HSPLIT);
    });
  });
});
