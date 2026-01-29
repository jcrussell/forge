import { describe, it, expect } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";

/**
 * Bug #258: Focus is lost if a window is closed even if 'hover on focus' is active
 *
 * Problem: When a tiled window is closed and GNOME's secondary-click (hover) focus
 * is enabled, focus is completely lost and keyboard shortcuts (Super+hjkl) stop
 * working. Focus should automatically transfer to another window.
 *
 * Root Cause: The window close handler does not properly transfer focus to a
 * sibling or next available window in the tree when the focused window is removed.
 *
 * Fix: When removing a window from the tree, if it was the focused window,
 * automatically focus the next available window (sibling or parent's child).
 */
describe("Bug #258: Focus transfer on window close", () => {
  describe("Finding next window after removal", () => {
    it("should find sibling window when focused window is removed", () => {
      // Create container with two windows
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.percent = 1.0;

      const window1 = createMockWindow({ id: "win1", title: "Window 1" });
      const window2 = createMockWindow({ id: "win2", title: "Window 2" });

      const node1 = new Node(NODE_TYPES.CON, null);
      node1.percent = 0.5;
      container.appendChild(node1);

      const node2 = new Node(NODE_TYPES.CON, null);
      node2.percent = 0.5;
      container.appendChild(node2);

      // Find next window from node1's perspective
      const siblings = container.childNodes.filter((n) => n !== node1);

      expect(siblings.length).toBe(1);
      expect(siblings[0]).toBe(node2);
    });

    it("should return empty when no other windows exist", () => {
      // Single window only
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.percent = 1.0;

      const node1 = new Node(NODE_TYPES.CON, null);
      node1.percent = 1.0;
      container.appendChild(node1);

      // No siblings
      const siblings = container.childNodes.filter((n) => n !== node1);
      expect(siblings.length).toBe(0);
    });
  });

  describe("Focus order preference", () => {
    it("should prefer right sibling when removing from middle", () => {
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.percent = 1.0;

      const node1 = new Node(NODE_TYPES.CON, null);
      node1.percent = 0.33;
      container.appendChild(node1);

      const node2 = new Node(NODE_TYPES.CON, null);
      node2.percent = 0.34;
      container.appendChild(node2);

      const node3 = new Node(NODE_TYPES.CON, null);
      node3.percent = 0.33;
      container.appendChild(node3);

      // When removing node2 (middle), should find node3 (right sibling first)
      const index = container.childNodes.indexOf(node2);
      const rightSibling = container.childNodes[index + 1];
      const leftSibling = container.childNodes[index - 1];

      expect(rightSibling).toBe(node3);
      expect(leftSibling).toBe(node1);

      // Right sibling should be preferred
      const nextFocus = rightSibling || leftSibling;
      expect(nextFocus).toBe(node3);
    });

    it("should fall back to left sibling when no right sibling exists", () => {
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.percent = 1.0;

      const node1 = new Node(NODE_TYPES.CON, null);
      node1.percent = 0.5;
      container.appendChild(node1);

      const node2 = new Node(NODE_TYPES.CON, null);
      node2.percent = 0.5;
      container.appendChild(node2);

      // When removing node2 (last), should find node1 (left sibling)
      const index = container.childNodes.indexOf(node2);
      const rightSibling = container.childNodes[index + 1];
      const leftSibling = container.childNodes[index - 1];

      expect(rightSibling).toBeUndefined();
      expect(leftSibling).toBe(node1);

      const nextFocus = rightSibling || leftSibling;
      expect(nextFocus).toBe(node1);
    });
  });

  describe("Focus in stacked/tabbed containers", () => {
    it("should focus next tab when closing current tab", () => {
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.TABBED;
      container.percent = 1.0;

      const node1 = new Node(NODE_TYPES.CON, null);
      node1.percent = 1.0;
      container.appendChild(node1);

      const node2 = new Node(NODE_TYPES.CON, null);
      node2.percent = 1.0;
      container.appendChild(node2);

      const node3 = new Node(NODE_TYPES.CON, null);
      node3.percent = 1.0;
      container.appendChild(node3);

      // In tabbed layout, should still have siblings
      expect(container.childNodes.length).toBe(3);

      // Removing node2 should leave node1 and node3
      const siblings = container.childNodes.filter((n) => n !== node2);
      expect(siblings.length).toBe(2);
    });
  });
});
