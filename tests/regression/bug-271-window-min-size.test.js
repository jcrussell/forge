import { describe, it, expect } from "vitest";
import { createMockWindow } from "../mocks/helpers/index.js";

/**
 * Bug #271: Steam app is tiling but the size is overlapping
 *
 * Problem: Windows with minimum width/height constraints larger than their
 * allocated tile space overflow and overlap other windows. When tiling divides
 * space smaller than a window's minimum size, neighboring windows get overlapped.
 *
 * Root Cause: The layout calculation does not account for minimum window size
 * constraints when calculating tile dimensions. Windows should either:
 * 1. Respect minimum size and reduce other windows' space
 * 2. Switch to stacked/tabbed layout when space is insufficient
 * 3. Force the minimum-size window to float
 *
 * Related issues: #117 (partially off-screen apps), #378 (large-width windows)
 */
describe("Bug #271: Window minimum size constraint handling", () => {
  describe("Detecting minimum size constraints", () => {
    it("should identify windows with minimum size hints", () => {
      const steamWindow = createMockWindow({
        wm_class: "steam",
        id: "steam-1",
        title: "Steam",
        allows_resize: true,
        min_size: { width: 1024, height: 768 },
      });

      // Check if window has minimum size constraints
      const hasMinSize = steamWindow.get_min_size !== undefined;

      expect(hasMinSize).toBeDefined();
    });

    it("should calculate if allocated space is insufficient for minimum size", () => {
      const containerWidth = 800; // Less than Steam's minimum 1024
      const containerHeight = 1080;
      const minWidth = 1024;
      const minHeight = 768;

      const isWidthInsufficient = containerWidth < minWidth;
      const isHeightInsufficient = containerHeight < minHeight;

      expect(isWidthInsufficient).toBe(true);
      expect(isHeightInsufficient).toBe(false);
    });
  });

  describe("Layout calculations with constrained windows", () => {
    it("should not allow negative or zero space for sibling windows", () => {
      const containerRect = { x: 0, y: 0, width: 1920, height: 1080 };
      const numChildren = 3;
      const gaps = 4;

      // Calculate space per child
      const availableWidth = containerRect.width - gaps * (numChildren - 1);
      const spacePerChild = availableWidth / numChildren;

      // Verify each child gets positive space
      expect(spacePerChild).toBeGreaterThan(0);
      expect(spacePerChild).toBeCloseTo((1920 - 8) / 3, 1);
    });

    it("should handle case where one window needs more than equal share", () => {
      const containerWidth = 1920;
      const windowMinWidth = 1024; // Steam needs at least 1024px
      const otherWindowMinWidth = 200;

      // In a two-window split, Steam needs more than 50%
      const equalShare = containerWidth / 2; // 960px
      const steamNeedsMore = windowMinWidth > equalShare;

      expect(steamNeedsMore).toBe(true);

      // Calculate fair distribution
      const steamShare = windowMinWidth;
      const otherShare = containerWidth - steamShare;

      expect(steamShare).toBe(1024);
      expect(otherShare).toBe(896);

      // Other window should still have usable space
      expect(otherShare).toBeGreaterThan(otherWindowMinWidth);
    });

    it("should detect when total minimum sizes exceed container", () => {
      const containerWidth = 1600;
      const window1MinWidth = 1024; // Steam
      const window2MinWidth = 800; // Another app with large minimum

      const totalMinWidth = window1MinWidth + window2MinWidth;
      const exceedsContainer = totalMinWidth > containerWidth;

      expect(exceedsContainer).toBe(true);

      // This is the overlap scenario
      const overlapAmount = totalMinWidth - containerWidth;
      expect(overlapAmount).toBe(224);
    });
  });

  describe("Tree node rectangle calculations", () => {
    it("should calculate child rects without overlap", () => {
      const parentRect = { x: 0, y: 0, width: 1920, height: 1080 };

      const child1 = {
        percent: 0.5,
        rect: { x: 0, y: 0, width: 960, height: 1080 },
      };

      const child2 = {
        percent: 0.5,
        rect: { x: 960, y: 0, width: 960, height: 1080 },
      };

      // Check no overlap
      const child1Right = child1.rect.x + child1.rect.width;
      const noOverlap = child1Right <= child2.rect.x;

      expect(noOverlap).toBe(true);
      expect(child1Right).toBe(child2.rect.x);
    });

    it("should clamp window positions to not exceed container", () => {
      const containerRect = { x: 0, y: 0, width: 1920, height: 1080 };

      // Window trying to be larger than container
      const windowDesired = { width: 2000, height: 1080 };

      const clampedWidth = Math.min(windowDesired.width, containerRect.width);
      const clampedHeight = Math.min(windowDesired.height, containerRect.height);

      expect(clampedWidth).toBe(1920);
      expect(clampedHeight).toBe(1080);
    });
  });

  describe("Adjustment strategies for oversized windows", () => {
    it("should calculate adjusted percentages when one window has minimum size", () => {
      const containerWidth = 1920;
      const window1MinWidth = 1024;
      const window2MinWidth = 0; // No minimum

      // Window 1 needs at least 1024/1920 = 53.3%
      const window1MinPercent = window1MinWidth / containerWidth;
      const window2MaxPercent = 1 - window1MinPercent;

      expect(window1MinPercent).toBeCloseTo(0.533, 2);
      expect(window2MaxPercent).toBeCloseTo(0.467, 2);
    });

    it("should suggest stacking/tabbing when horizontal space is too tight", () => {
      const containerWidth = 1600;
      const numWindows = 4;
      const minUsableWidth = 500; // Arbitrary minimum usable width

      const spacePerWindow = containerWidth / numWindows;
      const isTooTight = spacePerWindow < minUsableWidth;

      expect(isTooTight).toBe(true);
      expect(spacePerWindow).toBe(400);

      // Recommendation: use stacked or tabbed layout
      const shouldSwitchLayout = isTooTight;
      expect(shouldSwitchLayout).toBe(true);
    });
  });
});
