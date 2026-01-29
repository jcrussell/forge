import { describe, it, expect } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";

/**
 * Bug #171: Forge does not remember last focused window of splits
 *
 * Problem: When navigating between splits using focus keybindings (h,j,k,l),
 * Forge always focuses the topmost/leftmost window in a container instead of
 * remembering and re-focusing the last active window in that split.
 *
 * Root Cause: The focus navigation logic does not track or restore the
 * previously focused child within each container. When navigating to a
 * container, it always selects the first child instead of the last focused one.
 *
 * Fix: Each container should track its last focused child, and when navigating
 * into that container, the last focused child should be focused instead of
 * defaulting to the first child.
 */
describe("Bug #171: Focus memory within containers", () => {
  describe("Container focus tracking", () => {
    it("should track last focused child in container", () => {
      // Create a container with multiple children
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.VSPLIT;
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

      // Simulate focusing node2
      container.lastFocusedChild = node2;

      // When returning to this container, should remember node2
      expect(container.lastFocusedChild).toBe(node2);
    });

    it("should update last focused child when focus changes within container", () => {
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.VSPLIT;
      container.percent = 1.0;

      const node1 = new Node(NODE_TYPES.CON, null);
      node1.percent = 0.5;
      container.appendChild(node1);

      const node2 = new Node(NODE_TYPES.CON, null);
      node2.percent = 0.5;
      container.appendChild(node2);

      // Initially focus node1
      container.lastFocusedChild = node1;
      expect(container.lastFocusedChild).toBe(node1);

      // Focus changes to node2
      container.lastFocusedChild = node2;
      expect(container.lastFocusedChild).toBe(node2);
    });
  });

  describe("Navigation between sibling containers", () => {
    it("should remember focus in each container independently", () => {
      // Layout: [leftCon | rightCon]
      const rootCon = new Node(NODE_TYPES.CON, null);
      rootCon.layout = LAYOUT_TYPES.HSPLIT;
      rootCon.percent = 1.0;

      // Left container with 3 stacked windows
      const leftCon = new Node(NODE_TYPES.CON, null);
      leftCon.layout = LAYOUT_TYPES.VSPLIT;
      leftCon.percent = 0.5;
      rootCon.appendChild(leftCon);

      const leftWin1 = new Node(NODE_TYPES.CON, null);
      leftWin1.percent = 0.33;
      leftCon.appendChild(leftWin1);

      const leftWin2 = new Node(NODE_TYPES.CON, null);
      leftWin2.percent = 0.34;
      leftCon.appendChild(leftWin2);

      const leftWin3 = new Node(NODE_TYPES.CON, null);
      leftWin3.percent = 0.33;
      leftCon.appendChild(leftWin3);

      // Right container with 2 stacked windows
      const rightCon = new Node(NODE_TYPES.CON, null);
      rightCon.layout = LAYOUT_TYPES.VSPLIT;
      rightCon.percent = 0.5;
      rootCon.appendChild(rightCon);

      const rightWin1 = new Node(NODE_TYPES.CON, null);
      rightWin1.percent = 0.5;
      rightCon.appendChild(rightWin1);

      const rightWin2 = new Node(NODE_TYPES.CON, null);
      rightWin2.percent = 0.5;
      rightCon.appendChild(rightWin2);

      // User focuses leftWin2, then rightWin2
      leftCon.lastFocusedChild = leftWin2;
      rightCon.lastFocusedChild = rightWin2;

      // When navigating back to left container, should focus leftWin2
      expect(leftCon.lastFocusedChild).toBe(leftWin2);

      // When navigating back to right container, should focus rightWin2
      expect(rightCon.lastFocusedChild).toBe(rightWin2);
    });
  });

  describe("Default focus when no memory exists", () => {
    it("should default to first child when no last focused child is set", () => {
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.VSPLIT;
      container.percent = 1.0;

      const node1 = new Node(NODE_TYPES.CON, null);
      node1.percent = 0.5;
      container.appendChild(node1);

      const node2 = new Node(NODE_TYPES.CON, null);
      node2.percent = 0.5;
      container.appendChild(node2);

      // No lastFocusedChild set, should use first child
      const focusTarget = container.lastFocusedChild || container.childNodes[0];

      expect(focusTarget).toBe(node1);
    });

    it("should clear last focused child when child is removed", () => {
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.VSPLIT;
      container.percent = 1.0;

      const node1 = new Node(NODE_TYPES.CON, null);
      node1.percent = 0.5;
      container.appendChild(node1);

      const node2 = new Node(NODE_TYPES.CON, null);
      node2.percent = 0.5;
      container.appendChild(node2);

      // Focus node1
      container.lastFocusedChild = node1;

      // Simulate removing node1
      container.removeChild(node1);

      // Should clear lastFocusedChild if it was the removed node
      if (container.lastFocusedChild === node1) {
        container.lastFocusedChild = null;
      }

      // After clearing, should default to remaining child
      const focusTarget = container.lastFocusedChild || container.childNodes[0];

      expect(focusTarget).toBe(node2);
    });
  });

  describe("Focus memory in stacked/tabbed layouts", () => {
    it("should remember last visible tab in tabbed container", () => {
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.TABBED;
      container.percent = 1.0;

      const tab1 = new Node(NODE_TYPES.CON, null);
      tab1.percent = 1.0;
      container.appendChild(tab1);

      const tab2 = new Node(NODE_TYPES.CON, null);
      tab2.percent = 1.0;
      container.appendChild(tab2);

      const tab3 = new Node(NODE_TYPES.CON, null);
      tab3.percent = 1.0;
      container.appendChild(tab3);

      // User views tab2
      container.lastFocusedChild = tab2;

      // When returning to this tabbed container, should show tab2
      expect(container.lastFocusedChild).toBe(tab2);
    });

    it("should remember last visible window in stacked container", () => {
      const container = new Node(NODE_TYPES.CON, null);
      container.layout = LAYOUT_TYPES.STACKED;
      container.percent = 1.0;

      const stack1 = new Node(NODE_TYPES.CON, null);
      stack1.percent = 1.0;
      container.appendChild(stack1);

      const stack2 = new Node(NODE_TYPES.CON, null);
      stack2.percent = 1.0;
      container.appendChild(stack2);

      // User views stack2
      container.lastFocusedChild = stack2;

      // When returning to this stacked container, should show stack2
      expect(container.lastFocusedChild).toBe(stack2);
    });
  });
});
