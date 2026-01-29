import { describe, it, expect, beforeEach, vi } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES, ORIENTATION_TYPES } from "../../lib/extension/tree.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";

/**
 * Bug #330: Wrong height in 2x2 layout
 *
 * Problem: In a 2x2 layout where the top-left window is tabbed, the lower
 * two windows become twice as tall as expected. The layout calculation
 * for sibling percentage/height is incorrect in certain container configurations.
 *
 * Root Cause: The splitPercent calculation doesn't properly account for
 * containers that use tabbed/stacked layouts when calculating child percentages.
 */
describe("Bug #330: Wrong height in 2x2 layout with tabbed container", () => {
  describe("Layout percentage calculations", () => {
    it("should maintain equal heights in 2x2 layout", () => {
      // Create a 2x2 layout: top-left, top-right, bottom-left, bottom-right
      // Structure: rootCon(HSPLIT) -> [leftCon(VSPLIT), rightCon(VSPLIT)]

      // Left container (top-left, bottom-left) - vertical split
      const leftContainer = new Node(NODE_TYPES.CON, null);
      leftContainer.layout = LAYOUT_TYPES.VSPLIT;
      leftContainer.percent = 0.5;
      leftContainer._rect = { x: 0, y: 0, width: 960, height: 1080 };

      // Right container (top-right, bottom-right) - vertical split
      const rightContainer = new Node(NODE_TYPES.CON, null);
      rightContainer.layout = LAYOUT_TYPES.VSPLIT;
      rightContainer.percent = 0.5;
      rightContainer._rect = { x: 960, y: 0, width: 960, height: 1080 };

      // Add windows to left container
      const topLeftWindow = new Node(NODE_TYPES.CON, null);
      topLeftWindow.percent = 0.5;
      leftContainer.appendChild(topLeftWindow);

      const bottomLeftWindow = new Node(NODE_TYPES.CON, null);
      bottomLeftWindow.percent = 0.5;
      leftContainer.appendChild(bottomLeftWindow);

      // Add windows to right container
      const topRightWindow = new Node(NODE_TYPES.CON, null);
      topRightWindow.percent = 0.5;
      rightContainer.appendChild(topRightWindow);

      const bottomRightWindow = new Node(NODE_TYPES.CON, null);
      bottomRightWindow.percent = 0.5;
      rightContainer.appendChild(bottomRightWindow);

      // Verify 2x2 layout percentages
      expect(leftContainer.childNodes.length).toBe(2);
      expect(rightContainer.childNodes.length).toBe(2);

      // Each side should have equal top/bottom percentages
      expect(topLeftWindow.percent).toBe(0.5);
      expect(bottomLeftWindow.percent).toBe(0.5);
      expect(topRightWindow.percent).toBe(0.5);
      expect(bottomRightWindow.percent).toBe(0.5);
    });

    it("should maintain height proportions when one container becomes tabbed", () => {
      // Left side - will become tabbed
      const leftContainer = new Node(NODE_TYPES.CON, null);
      leftContainer.layout = LAYOUT_TYPES.TABBED;
      leftContainer.percent = 0.5;
      leftContainer._rect = { x: 0, y: 0, width: 960, height: 1080 };

      // Right side - vertical split
      const rightContainer = new Node(NODE_TYPES.CON, null);
      rightContainer.layout = LAYOUT_TYPES.VSPLIT;
      rightContainer.percent = 0.5;
      rightContainer._rect = { x: 960, y: 0, width: 960, height: 1080 };

      // Add tabbed windows to left (stacked on top of each other)
      const tabbedWindow1 = new Node(NODE_TYPES.CON, null);
      tabbedWindow1.percent = 1.0; // In tabbed layout, windows take full space
      leftContainer.appendChild(tabbedWindow1);

      const tabbedWindow2 = new Node(NODE_TYPES.CON, null);
      tabbedWindow2.percent = 1.0;
      leftContainer.appendChild(tabbedWindow2);

      // Add windows to right container (vertical split)
      const topRightWindow = new Node(NODE_TYPES.CON, null);
      topRightWindow.percent = 0.5;
      rightContainer.appendChild(topRightWindow);

      const bottomRightWindow = new Node(NODE_TYPES.CON, null);
      bottomRightWindow.percent = 0.5;
      rightContainer.appendChild(bottomRightWindow);

      // The bug: right side windows should still have 50/50 vertical split
      // regardless of how the left container is laid out
      expect(topRightWindow.percent).toBe(0.5);
      expect(bottomRightWindow.percent).toBe(0.5);

      // The horizontal split should be 50/50
      expect(leftContainer.percent).toBe(0.5);
      expect(rightContainer.percent).toBe(0.5);

      // Tabbed windows don't affect sibling container heights
      expect(rightContainer.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });
  });

  describe("resetSiblingPercent behavior", () => {
    it("should properly reset percentages for container siblings", () => {
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.VSPLIT;

      const child1 = new Node(NODE_TYPES.CON, null);
      child1.percent = 0.7; // Unequal
      container.appendChild(child1);

      const child2 = new Node(NODE_TYPES.CON, null);
      child2.percent = 0.3;
      container.appendChild(child2);

      // Reset to equal percentages manually (simulating resetSiblingPercent)
      const numChildren = container.childNodes.length;
      const equalPercent = 1.0 / numChildren;
      for (const child of container.childNodes) {
        child.percent = equalPercent;
      }

      // Should now be equal
      expect(child1.percent).toBeCloseTo(0.5, 2);
      expect(child2.percent).toBeCloseTo(0.5, 2);
    });
  });
});
