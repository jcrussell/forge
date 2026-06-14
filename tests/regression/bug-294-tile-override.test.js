import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug #294: Some windows cannot be tiled (Neovide, Blackbox)
 *
 * Problem: Certain applications (Neovide, Black Box terminal) always launch
 * in floating mode and cannot be toggled to tiled mode. Even editing
 * windows.json does not help because Forge was reading from the wrong config
 * path (.local/share/gnome-shell/extensions/ instead of .config/forge/config/).
 *
 * Root Cause: The issue has multiple aspects:
 * 1. Config file loading path was incorrect
 * 2. No explicit TILE override option existed to force-tile windows
 *
 * Fix: Added support for explicit "tile" mode in windows.json overrides
 * that takes precedence over default floating exemptions.
 */
describe("Bug #294: Explicit TILE override for windows that default to float", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("Explicit TILE override takes precedence over float exemptions", () => {
    it("should force-tile a window that would normally be floating exempt", () => {
      // Neovide-like window: uses wayland without proper decorations
      // which might trigger floating exemption
      ctx.configMgr.windowProps.overrides = [
        {
          wmClass: "Neovide",
          mode: "tile",
        },
      ];

      const neovideWindow = createMockWindow({
        wm_class: "Neovide",
        id: "neovide-1",
        title: "Neovide",
        allows_resize: true,
      });

      const isExempt = ctx.windowManager.isFloatingExempt(neovideWindow);

      // With explicit TILE override, should NOT be floating exempt
      expect(isExempt).toBe(false);
    });

    it("should force-tile by title when class-based override is insufficient", () => {
      // Black Box terminal scenario
      ctx.configMgr.windowProps.overrides = [
        {
          wmTitle: "Black Box",
          mode: "tile",
        },
      ];

      const blackboxWindow = createMockWindow({
        wm_class: "com.raggesilver.BlackBox",
        id: "blackbox-1",
        title: "Black Box",
        allows_resize: true,
      });

      const isExempt = ctx.windowManager.isFloatingExempt(blackboxWindow);

      expect(isExempt).toBe(false);
    });

    it("should tile window matching both class and title override", () => {
      ctx.configMgr.windowProps.overrides = [
        {
          wmClass: "Neovide",
          wmTitle: "nvim",
          mode: "tile",
        },
      ];

      // Window that matches both class and title
      const neovideWindow = createMockWindow({
        wm_class: "Neovide",
        id: "neovide-1",
        title: "nvim - project",
        allows_resize: true,
      });

      const isExempt = ctx.windowManager.isFloatingExempt(neovideWindow);

      expect(isExempt).toBe(false);
    });

    it("should not tile when window title does not match override title", () => {
      ctx.configMgr.windowProps.overrides = [
        {
          wmClass: "Neovide",
          wmTitle: "specific-project",
          mode: "tile",
        },
      ];

      // Window class matches but title doesn't. The window is non-resizable so it
      // floats BY DEFAULT — making the title-specific TILE override the only thing
      // that could tile it. Since the title doesn't match, the override doesn't
      // apply and the window must stay floating exempt.
      const neovideWindow = createMockWindow({
        wm_class: "Neovide",
        id: "neovide-1",
        title: "different-project",
        allows_resize: false,
      });

      const isExempt = ctx.windowManager.isFloatingExempt(neovideWindow);

      expect(isExempt).toBe(true);
    });

    it("should tile when window title DOES match the override title", () => {
      ctx.configMgr.windowProps.overrides = [
        {
          wmClass: "Neovide",
          wmTitle: "specific-project",
          mode: "tile",
        },
      ];

      // Same non-resizable (float-by-default) window, but now its title matches
      // the override's wmTitle (substring match), so the specific TILE override
      // applies and force-tiles it.
      const neovideWindow = createMockWindow({
        wm_class: "Neovide",
        id: "neovide-1",
        title: "specific-project - editing",
        allows_resize: false,
      });

      const isExempt = ctx.windowManager.isFloatingExempt(neovideWindow);

      expect(isExempt).toBe(false);
    });
  });

  describe("TILE override vs FLOAT override precedence", () => {
    it("should tile when TILE override exists even if FLOAT override also exists for different criteria", () => {
      // Complex scenario: class-based float, but title-based tile
      ctx.configMgr.windowProps.overrides = [
        {
          wmClass: "TestApp",
          mode: "float", // Float all TestApp windows
        },
        {
          wmClass: "TestApp",
          wmTitle: "WorkWindow",
          mode: "tile", // But tile TestApp windows with "WorkWindow" in title
        },
      ];

      const workWindow = createMockWindow({
        wm_class: "TestApp",
        id: "test-1",
        title: "WorkWindow - Project",
        allows_resize: true,
      });

      // TILE override should win when more specific
      const isExempt = ctx.windowManager.isFloatingExempt(workWindow);

      // The TILE check happens first in isFloatingExempt, so should not be exempt
      expect(isExempt).toBe(false);
    });

    it("should float when only FLOAT override matches", () => {
      ctx.configMgr.windowProps.overrides = [
        {
          wmClass: "TestApp",
          mode: "float",
        },
      ];

      const testWindow = createMockWindow({
        wm_class: "TestApp",
        id: "test-1",
        title: "Test Window",
        allows_resize: true,
      });

      const isExempt = ctx.windowManager.isFloatingExempt(testWindow);

      expect(isExempt).toBe(true);
    });
  });

  describe("Override matching behavior", () => {
    // The window is non-resizable, so it floats BY DEFAULT (floatByType). That
    // makes the class-only TILE override the only thing that can tile it, so the
    // result is decisive about how _wmClassMatches() compares the override class.
    // _wmClassMatches uses strict, comma-split equality (no substring matching).
    it("should NOT tile when override wmClass is only a partial (substring) of the window class", () => {
      ctx.configMgr.windowProps.overrides = [
        {
          wmClass: "raggesilver.BlackBox", // substring of the real class, NOT equal
          mode: "tile",
        },
      ];

      const blackboxWindow = createMockWindow({
        wm_class: "com.raggesilver.BlackBox",
        id: "blackbox-1",
        title: "Black Box",
        allows_resize: false, // floats by default unless the override tiles it
      });

      const isExempt = ctx.windowManager.isFloatingExempt(blackboxWindow);

      // Partial class does not match (strict equality), so the tile override does
      // not apply and the non-resizable window stays floating exempt.
      expect(isExempt).toBe(true);
    });

    it("should tile when override wmClass exactly equals the window class", () => {
      ctx.configMgr.windowProps.overrides = [
        {
          wmClass: "com.raggesilver.BlackBox", // exact match
          mode: "tile",
        },
      ];

      const blackboxWindow = createMockWindow({
        wm_class: "com.raggesilver.BlackBox",
        id: "blackbox-1",
        title: "Black Box",
        allows_resize: false, // would float by default; the override force-tiles it
      });

      const isExempt = ctx.windowManager.isFloatingExempt(blackboxWindow);

      // Exact class match => class-only TILE override applies (floatByRole is
      // false), so the window is force-tiled (not exempt).
      expect(isExempt).toBe(false);
    });
  });
});
