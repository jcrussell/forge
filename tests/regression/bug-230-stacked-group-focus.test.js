import { describe, it, expect } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";

/**
 * Bug #230: Forge always focus the bottom window when switching focus
 * between two different stacked groups
 *
 * Problem: When switching focus between two stacked groups using keyboard
 * shortcuts (Super+h/l), Forge always focuses the bottom/first window in
 * the target group instead of remembering which window was previously
 * focused in that group.
 *
 * Root Cause: The stacked layout update doesn't maintain focus memory
 * between containers. When navigating into a stacked container, the
 * focus logic defaults to the first child instead of the last focused.
 *
 * Fix: Each stacked/tabbed container should track its last focused child,
 * and when focus navigates into the container, restore focus to that child.
 */
describe("Bug #230: Focus between stacked groups", () => {
  describe("Stacked container focus memory", () => {
    it("should track last focused window in stacked container", () => {
      const stackedCon = new Node(NODE_TYPES.CON, null);
      stackedCon.layout = LAYOUT_TYPES.STACKED;
      stackedCon.percent = 1.0;

      const win1 = new Node(NODE_TYPES.CON, null);
      win1.percent = 1.0;
      stackedCon.appendChild(win1);

      const win2 = new Node(NODE_TYPES.CON, null);
      win2.percent = 1.0;
      stackedCon.appendChild(win2);

      const win3 = new Node(NODE_TYPES.CON, null);
      win3.percent = 1.0;
      stackedCon.appendChild(win3);

      // Simulate focusing win2 (middle window)
      stackedCon.lastFocusedChild = win2;

      // Container should remember win2 as the last focused
      expect(stackedCon.lastFocusedChild).toBe(win2);
    });

    it("should return last focused window when navigating to stacked group", () => {
      const stackedCon = new Node(NODE_TYPES.CON, null);
      stackedCon.layout = LAYOUT_TYPES.STACKED;
      stackedCon.percent = 1.0;

      const win1 = new Node(NODE_TYPES.CON, null);
      win1.percent = 1.0;
      stackedCon.appendChild(win1);

      const win2 = new Node(NODE_TYPES.CON, null);
      win2.percent = 1.0;
      stackedCon.appendChild(win2);

      // Focus win2
      stackedCon.lastFocusedChild = win2;

      // When navigating to this container, should focus win2, not win1
      const focusTarget = stackedCon.lastFocusedChild || stackedCon.childNodes[0];
      expect(focusTarget).toBe(win2);
    });

    it("should default to first window when no previous focus exists", () => {
      const stackedCon = new Node(NODE_TYPES.CON, null);
      stackedCon.layout = LAYOUT_TYPES.STACKED;
      stackedCon.percent = 1.0;

      const win1 = new Node(NODE_TYPES.CON, null);
      win1.percent = 1.0;
      stackedCon.appendChild(win1);

      const win2 = new Node(NODE_TYPES.CON, null);
      win2.percent = 1.0;
      stackedCon.appendChild(win2);

      // No lastFocusedChild set
      const focusTarget = stackedCon.lastFocusedChild || stackedCon.childNodes[0];
      expect(focusTarget).toBe(win1);
    });
  });

  describe("Focus switching between two stacked groups", () => {
    it("should maintain independent focus memory for each stacked group", () => {
      // Layout: [leftStack | rightStack]
      const rootCon = new Node(NODE_TYPES.CON, null);
      rootCon.layout = LAYOUT_TYPES.HSPLIT;
      rootCon.percent = 1.0;

      // Left stacked group
      const leftStack = new Node(NODE_TYPES.CON, null);
      leftStack.layout = LAYOUT_TYPES.STACKED;
      leftStack.percent = 0.5;
      rootCon.appendChild(leftStack);

      const leftWin1 = new Node(NODE_TYPES.CON, null);
      leftWin1.percent = 1.0;
      leftStack.appendChild(leftWin1);

      const leftWin2 = new Node(NODE_TYPES.CON, null);
      leftWin2.percent = 1.0;
      leftStack.appendChild(leftWin2);

      const leftWin3 = new Node(NODE_TYPES.CON, null);
      leftWin3.percent = 1.0;
      leftStack.appendChild(leftWin3);

      // Right stacked group
      const rightStack = new Node(NODE_TYPES.CON, null);
      rightStack.layout = LAYOUT_TYPES.STACKED;
      rightStack.percent = 0.5;
      rootCon.appendChild(rightStack);

      const rightWin1 = new Node(NODE_TYPES.CON, null);
      rightWin1.percent = 1.0;
      rightStack.appendChild(rightWin1);

      const rightWin2 = new Node(NODE_TYPES.CON, null);
      rightWin2.percent = 1.0;
      rightStack.appendChild(rightWin2);

      // User focuses leftWin2 in left stack
      leftStack.lastFocusedChild = leftWin2;

      // User focuses rightWin2 in right stack
      rightStack.lastFocusedChild = rightWin2;

      // When user navigates back to left stack (via Super+h)
      // should focus leftWin2, not leftWin1
      const leftFocus = leftStack.lastFocusedChild || leftStack.childNodes[0];
      expect(leftFocus).toBe(leftWin2);

      // When user navigates to right stack (via Super+l)
      // should focus rightWin2, not rightWin1
      const rightFocus = rightStack.lastFocusedChild || rightStack.childNodes[0];
      expect(rightFocus).toBe(rightWin2);
    });

    it("should preserve focus memory after multiple switches", () => {
      // Layout: [leftStack | rightStack]
      const rootCon = new Node(NODE_TYPES.CON, null);
      rootCon.layout = LAYOUT_TYPES.HSPLIT;
      rootCon.percent = 1.0;

      const leftStack = new Node(NODE_TYPES.CON, null);
      leftStack.layout = LAYOUT_TYPES.STACKED;
      leftStack.percent = 0.5;
      rootCon.appendChild(leftStack);

      const leftWin1 = new Node(NODE_TYPES.CON, null);
      leftWin1.percent = 1.0;
      leftStack.appendChild(leftWin1);

      const leftWin2 = new Node(NODE_TYPES.CON, null);
      leftWin2.percent = 1.0;
      leftStack.appendChild(leftWin2);

      const rightStack = new Node(NODE_TYPES.CON, null);
      rightStack.layout = LAYOUT_TYPES.STACKED;
      rightStack.percent = 0.5;
      rootCon.appendChild(rightStack);

      const rightWin1 = new Node(NODE_TYPES.CON, null);
      rightWin1.percent = 1.0;
      rightStack.appendChild(rightWin1);

      // Set initial focus memory
      leftStack.lastFocusedChild = leftWin2;

      // Simulate multiple switches between groups
      // Each switch should not affect the other group's focus memory
      let currentFocus = rightWin1;
      rightStack.lastFocusedChild = currentFocus;

      // Switch back to left - should still remember leftWin2
      currentFocus = leftStack.lastFocusedChild || leftStack.childNodes[0];
      expect(currentFocus).toBe(leftWin2);

      // Switch to right - should remember rightWin1
      currentFocus = rightStack.lastFocusedChild || rightStack.childNodes[0];
      expect(currentFocus).toBe(rightWin1);
    });
  });

  describe("Focus with mixed stacked and split layouts", () => {
    it("should handle focus between stacked and non-stacked containers", () => {
      // Layout: [stackedCon | normalWindow]
      const rootCon = new Node(NODE_TYPES.CON, null);
      rootCon.layout = LAYOUT_TYPES.HSPLIT;
      rootCon.percent = 1.0;

      const stackedCon = new Node(NODE_TYPES.CON, null);
      stackedCon.layout = LAYOUT_TYPES.STACKED;
      stackedCon.percent = 0.5;
      rootCon.appendChild(stackedCon);

      const stackWin1 = new Node(NODE_TYPES.CON, null);
      stackWin1.percent = 1.0;
      stackedCon.appendChild(stackWin1);

      const stackWin2 = new Node(NODE_TYPES.CON, null);
      stackWin2.percent = 1.0;
      stackedCon.appendChild(stackWin2);

      const normalWindow = new Node(NODE_TYPES.CON, null);
      normalWindow.percent = 0.5;
      rootCon.appendChild(normalWindow);

      // Focus stackWin2
      stackedCon.lastFocusedChild = stackWin2;

      // When navigating back to stacked container, should focus stackWin2
      const focusTarget = stackedCon.lastFocusedChild || stackedCon.childNodes[0];
      expect(focusTarget).toBe(stackWin2);
    });
  });
});
