import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug #292: toggle-float should use window-instance-id
 *
 * Problem: When using toggle-float, the matching logic uses window class and
 * title rather than window instance ID. This causes windows with the same
 * title (e.g., two terminals) to both float together when only one should
 * be floated.
 *
 * Root Cause: The float override matching checks wmClass and wmTitle but not
 * wmId (window instance ID). When two windows have identical class and title,
 * toggling float on one affects both.
 *
 * Fix: FloatToggle (Super+C) should use per-window wmId matching, while
 * FloatToggleAll (Super+Ctrl+C) should use class-based matching.
 *
 * Related: Bug #172 (toggling floating on one window toggles all of them)
 */
describe("Bug #292: toggle-float per-window vs per-class behavior", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("Per-window float override with wmId", () => {
    it("should add float override with wmId for FloatToggle action", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add float override for terminal1 only (with wmId)
      ctx.windowManager.addFloatOverride(terminal1, true); // true = withWmId

      const overrides = ctx.configMgr.windowProps.overrides;

      // Should have one override with wmId
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmClass).toBe("gnome-terminal");
      expect(overrides[0].wmId).toBe("terminal-1");

      // terminal1 should be floating exempt
      expect(ctx.windowManager.isFloatingExempt(terminal1)).toBe(true);

      // terminal2 should NOT be floating exempt (different wmId)
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(false);
    });

    it("should not affect other windows with same class when using per-window toggle", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add per-window override
      ctx.windowManager.addFloatOverride(terminal1, true);

      // terminal2 should still tile
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(false);
    });

    it("should allow multiple per-window overrides for same class", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add per-window overrides for both
      ctx.windowManager.addFloatOverride(terminal1, true);
      ctx.windowManager.addFloatOverride(terminal2, true);

      const overrides = ctx.configMgr.windowProps.overrides;

      // Should have two separate overrides
      expect(overrides.length).toBe(2);
      expect(overrides[0].wmId).toBe("terminal-1");
      expect(overrides[1].wmId).toBe("terminal-2");
    });
  });

  describe("Class-wide float override without wmId", () => {
    it("should add float override without wmId for FloatToggleAll action", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add class-wide float override (without wmId)
      ctx.windowManager.addFloatOverride(terminal1, false); // false = class-based

      const overrides = ctx.configMgr.windowProps.overrides;

      // Should have one override without wmId
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmClass).toBe("gnome-terminal");
      expect(overrides[0].wmId).toBeUndefined();

      // Both terminals should be floating exempt
      expect(ctx.windowManager.isFloatingExempt(terminal1)).toBe(true);
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(true);
    });
  });

  describe("Removing float overrides", () => {
    it("should remove per-window override without affecting class-wide override", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      const terminal2 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-2",
        title: "Terminal",
        allows_resize: true,
      });

      // Add class-wide and per-window overrides
      ctx.configMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal", mode: "float" }, // class-wide
        { wmClass: "gnome-terminal", wmId: "terminal-1", mode: "float" }, // per-window
      ];

      // Remove per-window override for terminal1
      ctx.windowManager.removeFloatOverride(terminal1, true);

      // Class-wide override should still exist
      const overrides = ctx.configMgr.windowProps.overrides;
      expect(overrides.length).toBe(1);
      expect(overrides[0].wmId).toBeUndefined();

      // terminal2 should still float (class-wide)
      expect(ctx.windowManager.isFloatingExempt(terminal2)).toBe(true);
    });

    it("should remove class-wide override and all associated per-window overrides", () => {
      ctx.configMgr.windowProps.overrides = [
        { wmClass: "gnome-terminal", mode: "float" },
        { wmClass: "gnome-terminal", wmId: "terminal-1", mode: "float" },
        { wmClass: "gnome-terminal", wmId: "terminal-2", mode: "float" },
      ];

      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      // Remove class-wide (should remove all for the class)
      ctx.windowManager.removeFloatOverride(terminal1, false);

      // All overrides for gnome-terminal should be removed
      const overrides = ctx.configMgr.windowProps.overrides;
      const terminalOverrides = overrides.filter((o) => o.wmClass === "gnome-terminal");
      expect(terminalOverrides.length).toBe(0);
    });
  });

  describe("Duplicate override prevention", () => {
    it("should not add duplicate per-window override", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      // Try to add the same override twice
      ctx.windowManager.addFloatOverride(terminal1, true);
      ctx.windowManager.addFloatOverride(terminal1, true);

      const overrides = ctx.configMgr.windowProps.overrides;

      // Should only have one override
      expect(overrides.length).toBe(1);
    });

    it("should not add duplicate class-wide override", () => {
      const terminal1 = createMockWindow({
        wm_class: "gnome-terminal",
        id: "terminal-1",
        title: "Terminal",
        allows_resize: true,
      });

      // Try to add class-wide override twice
      ctx.windowManager.addFloatOverride(terminal1, false);
      ctx.windowManager.addFloatOverride(terminal1, false);

      const overrides = ctx.configMgr.windowProps.overrides;

      // Should only have one override
      expect(overrides.length).toBe(1);
    });
  });
});
