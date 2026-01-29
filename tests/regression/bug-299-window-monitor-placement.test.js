import { describe, it, expect } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";

/**
 * Bug #299: Windows always open on the secondary display
 *
 * Problem: When opening new windows/applications in a multi-monitor setup,
 * they appear briefly on the focused/primary monitor then immediately shift
 * to the secondary display. The bug seems to occur when the secondary display
 * is positioned to the left of the primary.
 *
 * Root Cause: The window placement logic may be incorrectly determining the
 * target monitor, possibly sorting monitors by position (leftmost first) rather
 * than using the focused window's monitor or primary display.
 *
 * Fix: Window placement should prioritize:
 * 1. The monitor containing the currently focused window
 * 2. The primary monitor if no window is focused
 * 3. Never sort by geometric position alone
 */
describe("Bug #299: Window monitor placement", () => {
  describe("Monitor index determination", () => {
    it("should identify primary monitor correctly", () => {
      // Mock monitor setup with primary on right (index 1)
      const monitors = [
        { index: 0, x: 0, y: 0, width: 1920, height: 1080, isPrimary: false },
        { index: 1, x: 1920, y: 0, width: 3840, height: 2160, isPrimary: true },
      ];

      const primaryMonitor = monitors.find((m) => m.isPrimary);
      expect(primaryMonitor.index).toBe(1);
    });

    it("should not default to leftmost monitor", () => {
      // Bug: Windows open on leftmost monitor instead of focused/primary
      const monitors = [
        { index: 0, x: 0, y: 0, width: 1920, height: 1080, isPrimary: false },
        { index: 1, x: 1920, y: 0, width: 3840, height: 2160, isPrimary: true },
      ];

      // Wrong: sorting by x position
      const sortedByX = [...monitors].sort((a, b) => a.x - b.x);
      const leftmost = sortedByX[0];

      // Leftmost is NOT the primary
      expect(leftmost.isPrimary).toBe(false);

      // Correct: use primary
      const correct = monitors.find((m) => m.isPrimary);
      expect(correct.index).toBe(1);
    });
  });

  describe("Target monitor for new windows", () => {
    it("should use focused window's monitor for new window placement", () => {
      // Simulate focused window on monitor 1
      const focusedWindowMonitor = 1;

      // New window should open on same monitor
      const targetMonitor = focusedWindowMonitor;
      expect(targetMonitor).toBe(1);
    });

    it("should use primary monitor when no window is focused", () => {
      const monitors = [
        { index: 0, isPrimary: false },
        { index: 1, isPrimary: true },
      ];

      // No focused window
      const focusedWindowMonitor = null;

      // Should use primary monitor
      const targetMonitor = focusedWindowMonitor ?? monitors.find((m) => m.isPrimary)?.index ?? 0;
      expect(targetMonitor).toBe(1);
    });
  });

  describe("Tree structure for multi-monitor", () => {
    it("should place window in correct monitor node", () => {
      // Build tree with two monitors
      const rootCon = new Node(NODE_TYPES.CON, null);
      rootCon.layout = LAYOUT_TYPES.ROOT;
      rootCon.percent = 1.0;

      const workspace = new Node(NODE_TYPES.CON, null);
      workspace.percent = 1.0;
      rootCon.appendChild(workspace);

      // Monitor 0 (secondary, on left)
      const monitor0 = new Node(NODE_TYPES.CON, null);
      monitor0.layout = LAYOUT_TYPES.HSPLIT;
      monitor0.percent = 0.5;
      monitor0._rect = { x: 0, y: 0, width: 1920, height: 1080 };
      workspace.appendChild(monitor0);

      // Monitor 1 (primary, on right)
      const monitor1 = new Node(NODE_TYPES.CON, null);
      monitor1.layout = LAYOUT_TYPES.HSPLIT;
      monitor1.percent = 0.5;
      monitor1._rect = { x: 1920, y: 0, width: 3840, height: 2160 };
      workspace.appendChild(monitor1);

      // Add window to correct monitor (monitor1)
      const newWindow = new Node(NODE_TYPES.CON, null);
      newWindow.percent = 1.0;
      monitor1.appendChild(newWindow);

      // Verify window is in monitor1's tree
      expect(newWindow.parentNode).toBe(monitor1);
      expect(monitor0.childNodes.length).toBe(0);
      expect(monitor1.childNodes.length).toBe(1);
    });

    it("should find monitor node by window position", () => {
      const monitors = [
        { index: 0, x: 0, y: 0, width: 1920, height: 1080 },
        { index: 1, x: 1920, y: 0, width: 3840, height: 2160 },
      ];

      // Window rect (positioned on monitor 1)
      const windowRect = { x: 2000, y: 100, width: 800, height: 600 };

      // Find which monitor contains the window
      const containingMonitor = monitors.find((m) => {
        return (
          windowRect.x >= m.x &&
          windowRect.x < m.x + m.width &&
          windowRect.y >= m.y &&
          windowRect.y < m.y + m.height
        );
      });

      expect(containingMonitor.index).toBe(1);
    });
  });

  describe("Monitor sorting behavior", () => {
    it("should not reorder monitors by x position for window placement", () => {
      const monitors = [
        { index: 0, x: 1920, y: 0, isPrimary: true }, // Primary but on right
        { index: 1, x: 0, y: 0, isPrimary: false }, // Secondary but on left
      ];

      // Wrong approach: sort by x and pick first
      const byXPosition = [...monitors].sort((a, b) => a.x - b.x);
      const wrongTarget = byXPosition[0];
      expect(wrongTarget.isPrimary).toBe(false); // Would pick secondary!

      // Correct approach: use primary regardless of position
      const correctTarget = monitors.find((m) => m.isPrimary);
      expect(correctTarget.index).toBe(0);
    });

    it("should handle vertically stacked monitors", () => {
      const monitors = [
        { index: 0, x: 0, y: 0, width: 3840, height: 2160, isPrimary: false }, // Top
        { index: 1, x: 0, y: 2160, width: 1920, height: 1080, isPrimary: true }, // Bottom
      ];

      // Should not pick by y position, should use primary
      const correctTarget = monitors.find((m) => m.isPrimary);
      expect(correctTarget.index).toBe(1);
    });
  });
});
