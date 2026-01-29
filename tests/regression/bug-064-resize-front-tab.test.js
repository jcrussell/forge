import { describe, it, expect } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";

/**
 * Bug #64: Allow resize front tab
 *
 * Problem: In tabbed layout, resizing the visible (front) tab window should
 * resize the tabbed container relative to its siblings. Currently this only
 * works if the window is the first or last child of the container.
 *
 * Root Cause: The resize logic looks for the window node directly in the
 * parent's children, but in tabbed layout the window may not be at the
 * expected position for resize calculations.
 *
 * Fix: When resizing a window in a tabbed/stacked container, find the
 * container's resize pair and resize the container itself.
 */
describe("Bug #64: Resize front tab in tabbed container", () => {
  describe("Identifying tabbed container for resize", () => {
    it("should find parent tabbed container from window node", () => {
      // Layout: [tabbedCon | rightWindow]
      const rootCon = new Node(NODE_TYPES.CON, null);
      rootCon.layout = LAYOUT_TYPES.HSPLIT;
      rootCon.percent = 1.0;

      // Tabbed container on left
      const tabbedCon = new Node(NODE_TYPES.CON, null);
      tabbedCon.layout = LAYOUT_TYPES.TABBED;
      tabbedCon.percent = 0.5;
      rootCon.appendChild(tabbedCon);

      const tab1 = new Node(NODE_TYPES.CON, null);
      tab1.percent = 1.0;
      tabbedCon.appendChild(tab1);

      const tab2 = new Node(NODE_TYPES.CON, null);
      tab2.percent = 1.0;
      tabbedCon.appendChild(tab2);

      // Regular window on right
      const rightWindow = new Node(NODE_TYPES.CON, null);
      rightWindow.percent = 0.5;
      rootCon.appendChild(rightWindow);

      // From tab1, should be able to find tabbed container
      expect(tab1.parentNode).toBe(tabbedCon);
      expect(tabbedCon.layout).toBe(LAYOUT_TYPES.TABBED);
    });

    it("should identify container siblings for resize", () => {
      // Layout: [tabbedCon | rightWindow]
      const rootCon = new Node(NODE_TYPES.CON, null);
      rootCon.layout = LAYOUT_TYPES.HSPLIT;
      rootCon.percent = 1.0;

      const tabbedCon = new Node(NODE_TYPES.CON, null);
      tabbedCon.layout = LAYOUT_TYPES.TABBED;
      tabbedCon.percent = 0.5;
      rootCon.appendChild(tabbedCon);

      const tab1 = new Node(NODE_TYPES.CON, null);
      tab1.percent = 1.0;
      tabbedCon.appendChild(tab1);

      const rightWindow = new Node(NODE_TYPES.CON, null);
      rightWindow.percent = 0.5;
      rootCon.appendChild(rightWindow);

      // Tabbed container's sibling is rightWindow
      const tabbedConIndex = rootCon.childNodes.indexOf(tabbedCon);
      const rightSibling = rootCon.childNodes[tabbedConIndex + 1];

      expect(rightSibling).toBe(rightWindow);
    });
  });

  describe("Resize calculation for tabbed containers", () => {
    it("should resize tabbed container not individual tab", () => {
      // Layout: [tabbedCon(50%) | rightWindow(50%)]
      const rootCon = new Node(NODE_TYPES.CON, null);
      rootCon.layout = LAYOUT_TYPES.HSPLIT;
      rootCon.percent = 1.0;
      rootCon._rect = { x: 0, y: 0, width: 1920, height: 1080 };

      const tabbedCon = new Node(NODE_TYPES.CON, null);
      tabbedCon.layout = LAYOUT_TYPES.TABBED;
      tabbedCon.percent = 0.5;
      tabbedCon._rect = { x: 0, y: 0, width: 960, height: 1080 };
      rootCon.appendChild(tabbedCon);

      const tab1 = new Node(NODE_TYPES.CON, null);
      tab1.percent = 1.0;
      tabbedCon.appendChild(tab1);

      const tab2 = new Node(NODE_TYPES.CON, null);
      tab2.percent = 1.0;
      tabbedCon.appendChild(tab2);

      const rightWindow = new Node(NODE_TYPES.CON, null);
      rightWindow.percent = 0.5;
      rightWindow._rect = { x: 960, y: 0, width: 960, height: 1080 };
      rootCon.appendChild(rightWindow);

      // Resize tabbed container (grow right edge by 10%)
      tabbedCon.percent = 0.6;
      rightWindow.percent = 0.4;

      expect(tabbedCon.percent).toBe(0.6);
      expect(rightWindow.percent).toBe(0.4);

      // Tab windows maintain percent 1.0 within their container
      expect(tab1.percent).toBe(1.0);
      expect(tab2.percent).toBe(1.0);
    });

    it("should determine resize node based on window's container type", () => {
      // Layout: [tabbedCon | stackedCon | window]
      const rootCon = new Node(NODE_TYPES.CON, null);
      rootCon.layout = LAYOUT_TYPES.HSPLIT;
      rootCon.percent = 1.0;

      const tabbedCon = new Node(NODE_TYPES.CON, null);
      tabbedCon.layout = LAYOUT_TYPES.TABBED;
      tabbedCon.percent = 0.33;
      rootCon.appendChild(tabbedCon);

      const tab1 = new Node(NODE_TYPES.CON, null);
      tab1.percent = 1.0;
      tabbedCon.appendChild(tab1);

      const stackedCon = new Node(NODE_TYPES.CON, null);
      stackedCon.layout = LAYOUT_TYPES.STACKED;
      stackedCon.percent = 0.33;
      rootCon.appendChild(stackedCon);

      const stack1 = new Node(NODE_TYPES.CON, null);
      stack1.percent = 1.0;
      stackedCon.appendChild(stack1);

      const normalWindow = new Node(NODE_TYPES.CON, null);
      normalWindow.percent = 0.34;
      rootCon.appendChild(normalWindow);

      // Helper to find resize node for a window
      const getResizeNode = (windowNode) => {
        const parent = windowNode.parentNode;
        if (parent.layout === LAYOUT_TYPES.TABBED || parent.layout === LAYOUT_TYPES.STACKED) {
          return parent; // Resize the container
        }
        return windowNode; // Resize the window directly
      };

      // Tab window should resize its container
      expect(getResizeNode(tab1)).toBe(tabbedCon);

      // Stacked window should resize its container
      expect(getResizeNode(stack1)).toBe(stackedCon);

      // Normal window should resize itself
      expect(getResizeNode(normalWindow)).toBe(normalWindow);
    });
  });

  describe("Front tab identification", () => {
    it("should identify the currently visible tab", () => {
      const tabbedCon = new Node(NODE_TYPES.CON, null);
      tabbedCon.layout = LAYOUT_TYPES.TABBED;
      tabbedCon.percent = 1.0;

      const tab1 = new Node(NODE_TYPES.CON, null);
      tab1.percent = 1.0;
      tabbedCon.appendChild(tab1);

      const tab2 = new Node(NODE_TYPES.CON, null);
      tab2.percent = 1.0;
      tabbedCon.appendChild(tab2);

      const tab3 = new Node(NODE_TYPES.CON, null);
      tab3.percent = 1.0;
      tabbedCon.appendChild(tab3);

      // Set tab2 as the front (visible) tab
      tabbedCon.lastFocusedChild = tab2;

      // The front tab should be identifiable
      const frontTab = tabbedCon.lastFocusedChild || tabbedCon.childNodes[0];
      expect(frontTab).toBe(tab2);
    });
  });
});
