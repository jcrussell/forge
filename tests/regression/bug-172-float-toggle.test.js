import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug #172: Toggle float on one window toggles all of same type
 *
 * Problem: When toggling floating on one gnome-terminal window, all gnome-terminal
 * instances become floating instead of just the one.
 *
 * Root Cause: In isFloatingExempt(), the condition treats wmId as optional,
 * so class-based overrides (without wmId) match ALL windows of that class.
 * Additionally, addFloatOverride() duplicate check may prevent per-window overrides.
 */
describe("Bug #172: Per-window float toggle", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("FloatToggle (per-window)", () => {
    it("should only float the specific window when using FloatToggle", () => {
      // Create two terminal windows with same wmClass but different wmIds
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Add both windows to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal2);

      nodeWindow1.mode = WINDOW_MODES.TILE;
      nodeWindow2.mode = WINDOW_MODES.TILE;

      // Float only terminal1 using per-window toggle
      const action = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      ctx.windowManager.toggleFloatingMode(action, terminal1);

      // After toggle, terminal1 should be floating
      expect(ctx.windowManager.isFloatingExempt(terminal1)).toBe(true);

      // Bug #172: terminal2 should NOT be affected
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(false);
    });

    it("should properly unfloat just one window", () => {
      // Create two terminal windows
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Add both windows to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal1);
      const nodeWindow2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal2);

      // Float both windows initially using per-window toggle
      const floatAction = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      ctx.windowManager.toggleFloatingMode(floatAction, terminal1);
      ctx.windowManager.toggleFloatingMode(floatAction, terminal2);

      expect(ctx.windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(true);

      // Now unfloat only terminal1
      const unfloatAction = { name: "FloatToggle", mode: WINDOW_MODES.TILE };
      ctx.windowManager.toggleFloatingMode(unfloatAction, terminal1);

      // terminal1 should no longer be floating
      expect(ctx.windowManager.isFloatingExempt(terminal1)).toBe(false);

      // Bug #172: terminal2 should still be floating
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(true);
    });

    it("should not affect other windows of same wmClass when FloatToggle is used", () => {
      // Create three terminal windows
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      const terminal3 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1003,
        title: "Terminal 3",
        allows_resize: true,
      });

      // Add windows to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal2);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal3);

      // Float terminal2 only
      const action = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      ctx.windowManager.toggleFloatingMode(action, terminal2);

      // Only terminal2 should be floating
      expect(ctx.windowManager.isFloatingExempt(terminal1)).toBe(false);
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(true);
      expect(ctx.windowManager.isFloatingExempt(terminal3)).toBe(false);
    });
  });

  describe("FloatClassToggle (class-based)", () => {
    it("should float ALL windows of same class when FloatClassToggle is used", () => {
      // Create two terminal windows
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Add windows to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, terminal2);

      // Float using class-based toggle
      const action = { name: "FloatClassToggle", mode: WINDOW_MODES.FLOAT };
      ctx.windowManager.toggleFloatingMode(action, terminal1);

      // Both terminals should be floating (class-based behavior)
      expect(ctx.windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(true);
    });
  });

  describe("addFloatOverride per-window handling", () => {
    it("should add per-window override with wmId when withWmId is true", () => {
      const terminal = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal",
        allows_resize: true,
      });

      ctx.windowManager.addFloatOverride(terminal, true);

      const overrides = ctx.configMgr.windowProps.overrides;
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmId).toBe(1001);
      expect(overrides[0].wmClass).toBe("gnome-terminal-server");
    });

    it("should allow multiple per-window overrides for same wmClass", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      ctx.windowManager.addFloatOverride(terminal1, true);
      ctx.windowManager.addFloatOverride(terminal2, true);

      const overrides = ctx.configMgr.windowProps.overrides;
      expect(overrides.length).toBe(2);
      expect(overrides.some((o) => o.wmId === 1001)).toBe(true);
      expect(overrides.some((o) => o.wmId === 1002)).toBe(true);
    });

    it("should not add duplicate per-window override for same wmId", () => {
      const terminal = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal",
        allows_resize: true,
      });

      ctx.windowManager.addFloatOverride(terminal, true);
      ctx.windowManager.addFloatOverride(terminal, true);

      const overrides = ctx.configMgr.windowProps.overrides;
      expect(overrides.length).toBe(1);
    });
  });

  describe("removeFloatOverride per-window handling", () => {
    it("should only remove per-window override when withWmId is true", () => {
      // Setup: Add both class-based and per-window overrides
      ctx.configMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal-server", mode: "float" }, // class-based
        { wmClass: "gnome-terminal-server", wmId: 1001, mode: "float" }, // per-window
      ];

      const terminal = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal",
        allows_resize: true,
      });

      // Remove per-window override only
      ctx.windowManager.removeFloatOverride(terminal, true);

      const overrides = ctx.configMgr.windowProps.overrides;
      // Class-based override should remain
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmId).toBeUndefined();
    });

    it("should preserve other per-window overrides for same class", () => {
      // Setup: Add multiple per-window overrides
      ctx.configMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal-server", wmId: 1001, mode: "float" },
        { wmClass: "gnome-terminal-server", wmId: 1002, mode: "float" },
        { wmClass: "gnome-terminal-server", wmId: 1003, mode: "float" },
      ];

      const terminal = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal",
        allows_resize: true,
      });

      // Remove override for terminal with id 1002
      ctx.windowManager.removeFloatOverride(terminal, true);

      const overrides = ctx.configMgr.windowProps.overrides;
      expect(overrides.length).toBe(2);
      expect(overrides.some((o) => o.wmId === 1001)).toBe(true);
      expect(overrides.some((o) => o.wmId === 1002)).toBe(false);
      expect(overrides.some((o) => o.wmId === 1003)).toBe(true);
    });
  });

  describe("isFloatingExempt per-window matching", () => {
    it("should match per-window override only for specific wmId", () => {
      ctx.configMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal-server", wmId: 1001, mode: "float" },
      ];

      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Only terminal1 should match because wmId matches
      expect(ctx.windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(false);
    });

    it("should match class-based override for all windows of that class", () => {
      ctx.configMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal-server", mode: "float" }, // no wmId = class-based
      ];

      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1001,
        title: "Terminal 1",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal-server",
        id: 1002,
        title: "Terminal 2",
        allows_resize: true,
      });

      // Both should match because it's class-based
      expect(ctx.windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(true);
    });
  });
});
