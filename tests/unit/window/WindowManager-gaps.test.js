import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../../mocks/helpers/index.js";

/**
 * WindowManager gap calculations tests
 *
 * Tests for calculateGaps method - pure mathematical calculations
 * that determine window spacing based on settings and window count.
 */
describe("WindowManager - Gap Calculations", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "window-gap-size": 4,
        "window-gap-size-increment": 1,
        "window-gap-hidden-on-single": false,
        "tiling-mode-enabled": true,
        "focus-on-hover-enabled": false,
      },
    });
  });

  // Convenience accessor
  const wm = () => ctx.windowManager;

  describe("Basic Gap Calculation", () => {
    it("should calculate gap as gapSize * gapIncrement", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 4;
        if (key === "window-gap-size-increment") return 3;
        return 0;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, { mode: "TILE" });

      const gap = wm().calculateGaps(nodeWindow);

      expect(gap).toBe(12); // 4 * 3 = 12
    });

    it("should return 0 when gapSize is 0", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 0;
        if (key === "window-gap-size-increment") return 5;
        return 0;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, { mode: "TILE" });

      const gap = wm().calculateGaps(nodeWindow);

      expect(gap).toBe(0); // 0 * 5 = 0
    });

    it("should return 0 when gapIncrement is 0", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 8;
        if (key === "window-gap-size-increment") return 0;
        return 0;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, { mode: "TILE" });

      const gap = wm().calculateGaps(nodeWindow);

      expect(gap).toBe(0); // 8 * 0 = 0
    });
  });

  describe("hideGapWhenSingle Setting", () => {
    it("should return 0 when hideGapWhenSingle is enabled with single tiled window", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 4;
        if (key === "window-gap-size-increment") return 2;
        return 0;
      });
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "window-gap-hidden-on-single") return true;
        if (key === "tiling-mode-enabled") return true;
        return false;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, { mode: "TILE" });

      const gap = wm().calculateGaps(nodeWindow);

      expect(gap).toBe(0); // Single window, hideGapWhenSingle = true
    });

    it("should return gap when hideGapWhenSingle is enabled with multiple tiled windows", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 4;
        if (key === "window-gap-size-increment") return 2;
        return 0;
      });
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "window-gap-hidden-on-single") return true;
        if (key === "tiling-mode-enabled") return true;
        return false;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create first window
      const { nodeWindow: nodeWindow1 } = createWindowNode(ctx.tree, monitor, {
        mode: "TILE",
        windowOverrides: { id: 1 },
      });

      // Create second window
      createWindowNode(ctx.tree, monitor, {
        mode: "TILE",
        windowOverrides: { id: 2 },
      });

      const gap = wm().calculateGaps(nodeWindow1);

      expect(gap).toBe(8); // Multiple windows, should return gap (4 * 2 = 8)
    });

    it("should return gap when hideGapWhenSingle is disabled with single window", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 6;
        if (key === "window-gap-size-increment") return 2;
        return 0;
      });
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "window-gap-hidden-on-single") return false;
        if (key === "tiling-mode-enabled") return true;
        return false;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, { mode: "TILE" });

      const gap = wm().calculateGaps(nodeWindow);

      expect(gap).toBe(12); // hideGapWhenSingle = false, should return gap (6 * 2 = 12)
    });

    it("should exclude minimized windows from count", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 4;
        if (key === "window-gap-size-increment") return 2;
        return 0;
      });
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "window-gap-hidden-on-single") return true;
        if (key === "tiling-mode-enabled") return true;
        return false;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create first window (not minimized)
      const { nodeWindow: nodeWindow1 } = createWindowNode(ctx.tree, monitor, {
        mode: "TILE",
        windowOverrides: { id: 1, minimized: false },
      });

      // Create second window (minimized, should be excluded)
      createWindowNode(ctx.tree, monitor, {
        mode: "TILE",
        windowOverrides: { id: 2, minimized: true },
      });

      const gap = wm().calculateGaps(nodeWindow1);

      // Only one non-minimized window, so gap should be 0
      expect(gap).toBe(0);
    });

    it("should exclude floating windows from count", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 4;
        if (key === "window-gap-size-increment") return 2;
        return 0;
      });
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "window-gap-hidden-on-single") return true;
        if (key === "tiling-mode-enabled") return true;
        return false;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create first window (tiled)
      const { nodeWindow: nodeWindow1 } = createWindowNode(ctx.tree, monitor, {
        mode: "TILE",
        windowOverrides: { id: 1 },
      });

      // Create second window (floating, should be excluded)
      createWindowNode(ctx.tree, monitor, {
        mode: "FLOAT",
        windowOverrides: { id: 2 },
      });

      const gap = wm().calculateGaps(nodeWindow1);

      // Only one tiled window, so gap should be 0
      expect(gap).toBe(0);
    });

    it("should only count tiled, non-minimized windows", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 5;
        if (key === "window-gap-size-increment") return 3;
        return 0;
      });
      ctx.settings.get_boolean.mockImplementation((key) => {
        if (key === "window-gap-hidden-on-single") return true;
        if (key === "tiling-mode-enabled") return true;
        return false;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create first window (tiled, not minimized) - COUNTED
      const { nodeWindow: nodeWindow1 } = createWindowNode(ctx.tree, monitor, {
        mode: "TILE",
        windowOverrides: { id: 1, minimized: false },
      });

      // Create second window (tiled, not minimized) - COUNTED
      createWindowNode(ctx.tree, monitor, {
        mode: "TILE",
        windowOverrides: { id: 2, minimized: false },
      });

      // Create third window (tiled, minimized) - NOT COUNTED
      createWindowNode(ctx.tree, monitor, {
        mode: "TILE",
        windowOverrides: { id: 3, minimized: true },
      });

      // Create fourth window (floating) - NOT COUNTED
      createWindowNode(ctx.tree, monitor, {
        mode: "FLOAT",
        windowOverrides: { id: 4, minimized: false },
      });

      const gap = wm().calculateGaps(nodeWindow1);

      // Two tiled, non-minimized windows, so gap should be returned (5 * 3 = 15)
      expect(gap).toBe(15);
    });
  });

  describe("Root Node Handling", () => {
    it("should return gap for root node (workspace)", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 10;
        if (key === "window-gap-size-increment") return 2;
        return 0;
      });

      const { workspace } = getWorkspaceAndMonitor(ctx);
      const gap = wm().calculateGaps(workspace);

      // Root nodes always return the gap (no hideGapWhenSingle logic)
      expect(gap).toBe(20); // 10 * 2 = 20
    });

    it("should return gap for monitor node", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 3;
        if (key === "window-gap-size-increment") return 4;
        return 0;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const gap = wm().calculateGaps(monitor);

      // Monitor nodes always return the gap (no hideGapWhenSingle logic)
      expect(gap).toBe(12); // 3 * 4 = 12
    });
  });

  describe("Edge Cases", () => {
    it("should handle container nodes", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 5;
        if (key === "window-gap-size-increment") return 2;
        return 0;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create a container
      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, null);

      // Create windows in the container
      createWindowNode(ctx.tree, container, {
        mode: "TILE",
        windowOverrides: { id: 1 },
      });

      const gap = wm().calculateGaps(container);

      // Container should return gap (hideGapWhenSingle is false by default in beforeEach)
      expect(gap).toBe(10); // 5 * 2 = 10
    });

    it("should handle very large gap values", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 999;
        if (key === "window-gap-size-increment") return 999;
        return 0;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, { mode: "TILE" });

      const gap = wm().calculateGaps(nodeWindow);

      expect(gap).toBe(998001); // 999 * 999 = 998001
    });

    it("should consistently calculate gap for same settings", () => {
      ctx.settings.get_uint.mockImplementation((key) => {
        if (key === "window-gap-size") return 7;
        if (key === "window-gap-size-increment") return 3;
        return 0;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, { mode: "TILE" });

      const gap1 = wm().calculateGaps(nodeWindow);
      const gap2 = wm().calculateGaps(nodeWindow);
      const gap3 = wm().calculateGaps(nodeWindow);

      expect(gap1).toBe(21);
      expect(gap2).toBe(21);
      expect(gap3).toBe(21);
    });
  });
});
