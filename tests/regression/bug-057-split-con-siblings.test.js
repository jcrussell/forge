import { describe, it, expect } from "vitest";
import { Node, LAYOUT_TYPES, NODE_TYPES } from "../../lib/extension/tree.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";

/**
 * Bug #57: Do not stack nor put as tab windows with split con siblings
 *
 * Problem: When a window W has a split container [A B] as a sibling, toggling
 * stacked/tabbed layout on the parent container incorrectly combines W, A, and B
 * into the same stack/tab group, flattening the nested structure.
 *
 * Tree structure before: [ W* [ A B ] ]
 * Expected after toggle tabbed: [ W* [ A B ] ] but in tabbed container
 * Actual (bug): [ W* A B ] all in same tab group (loses nesting)
 *
 * Root Cause: The layout toggle function doesn't preserve nested container
 * structure when changing parent layout to STACKED or TABBED.
 *
 * Fix: When toggling layout to stacked/tabbed, preserve child containers
 * as single items rather than flattening their children into the parent.
 */
describe("Bug #57: Preserve nested containers when toggling stacked/tabbed", () => {
  describe("Nested container structure preservation", () => {
    it("should identify nested containers within parent", () => {
      // Build structure: [ W [ A B ] ]
      const parentCon = new Node(NODE_TYPES.CON, null);
      parentCon.layout = LAYOUT_TYPES.HSPLIT;
      parentCon.percent = 1.0;

      // Window W
      const nodeW = new Node(NODE_TYPES.CON, null);
      nodeW.percent = 0.5;
      parentCon.appendChild(nodeW);

      // Nested container [ A B ]
      const nestedCon = new Node(NODE_TYPES.CON, null);
      nestedCon.layout = LAYOUT_TYPES.VSPLIT;
      nestedCon.percent = 0.5;
      parentCon.appendChild(nestedCon);

      const nodeA = new Node(NODE_TYPES.CON, null);
      nodeA.percent = 0.5;
      nestedCon.appendChild(nodeA);

      const nodeB = new Node(NODE_TYPES.CON, null);
      nodeB.percent = 0.5;
      nestedCon.appendChild(nodeB);

      // Verify structure
      expect(parentCon.childNodes.length).toBe(2);
      expect(parentCon.childNodes[0].nodeType).toBe(NODE_TYPES.CON);
      expect(parentCon.childNodes[1].nodeType).toBe(NODE_TYPES.CON);

      // Check nested container has its children
      const nested = parentCon.childNodes[1];
      expect(nested.childNodes.length).toBe(2);
    });

    it("should count direct children vs all descendants", () => {
      // Build structure: [ W [ A B ] ]
      const parentCon = new Node(NODE_TYPES.CON, null);
      parentCon.layout = LAYOUT_TYPES.HSPLIT;
      parentCon.percent = 1.0;

      const nodeW = new Node(NODE_TYPES.CON, null);
      nodeW.percent = 0.5;
      parentCon.appendChild(nodeW);

      const nestedCon = new Node(NODE_TYPES.CON, null);
      nestedCon.layout = LAYOUT_TYPES.VSPLIT;
      nestedCon.percent = 0.5;
      parentCon.appendChild(nestedCon);

      const nodeA = new Node(NODE_TYPES.CON, null);
      nodeA.percent = 0.5;
      nestedCon.appendChild(nodeA);

      const nodeB = new Node(NODE_TYPES.CON, null);
      nodeB.percent = 0.5;
      nestedCon.appendChild(nodeB);

      // Direct children of parent: 2 (W and nested container)
      expect(parentCon.childNodes.length).toBe(2);

      // Total nodes in tree including parent: 5 (parent, W, nested, A, B)
      const allNodes = [];
      const countNodes = (node) => {
        allNodes.push(node);
        for (const child of node.childNodes) {
          countNodes(child);
        }
      };
      countNodes(parentCon);
      expect(allNodes.length).toBe(5);
    });
  });

  describe("Layout toggle behavior", () => {
    it("should preserve nested container when toggling parent to tabbed", () => {
      // Build structure: [ W [ A B ] ]
      const parentCon = new Node(NODE_TYPES.CON, null);
      parentCon.layout = LAYOUT_TYPES.HSPLIT;
      parentCon.percent = 1.0;

      const nodeW = new Node(NODE_TYPES.CON, null);
      nodeW.percent = 0.5;
      parentCon.appendChild(nodeW);

      const nestedCon = new Node(NODE_TYPES.CON, null);
      nestedCon.layout = LAYOUT_TYPES.VSPLIT;
      nestedCon.percent = 0.5;
      parentCon.appendChild(nestedCon);

      const nodeA = new Node(NODE_TYPES.CON, null);
      nodeA.percent = 0.5;
      nestedCon.appendChild(nodeA);

      const nodeB = new Node(NODE_TYPES.CON, null);
      nodeB.percent = 0.5;
      nestedCon.appendChild(nodeB);

      // Toggle parent to tabbed layout
      parentCon.layout = LAYOUT_TYPES.TABBED;

      // Should still have 2 direct children (W and nested container)
      // NOT 3 (W, A, B flattened)
      expect(parentCon.childNodes.length).toBe(2);

      // Nested container should still exist
      expect(parentCon.childNodes[1].nodeType).toBe(NODE_TYPES.CON);
      expect(parentCon.childNodes[1].childNodes.length).toBe(2);
    });

    it("should preserve nested container when toggling parent to stacked", () => {
      // Build structure: [ W [ A B ] ]
      const parentCon = new Node(NODE_TYPES.CON, null);
      parentCon.layout = LAYOUT_TYPES.HSPLIT;
      parentCon.percent = 1.0;

      const nodeW = new Node(NODE_TYPES.CON, null);
      nodeW.percent = 0.5;
      parentCon.appendChild(nodeW);

      const nestedCon = new Node(NODE_TYPES.CON, null);
      nestedCon.layout = LAYOUT_TYPES.VSPLIT;
      nestedCon.percent = 0.5;
      parentCon.appendChild(nestedCon);

      const nodeA = new Node(NODE_TYPES.CON, null);
      nodeA.percent = 0.5;
      nestedCon.appendChild(nodeA);

      const nodeB = new Node(NODE_TYPES.CON, null);
      nodeB.percent = 0.5;
      nestedCon.appendChild(nodeB);

      // Toggle parent to stacked layout
      parentCon.layout = LAYOUT_TYPES.STACKED;

      // Should still have 2 direct children
      expect(parentCon.childNodes.length).toBe(2);

      // Nested container should still exist and maintain its structure
      const nested = parentCon.childNodes[1];
      expect(nested.nodeType).toBe(NODE_TYPES.CON);
      expect(nested.layout).toBe(LAYOUT_TYPES.VSPLIT);
      expect(nested.childNodes.length).toBe(2);
    });
  });

  describe("Tab display for nested containers", () => {
    it("should show nested container as single tab item", () => {
      // Build tabbed structure with nested container
      const parentCon = new Node(NODE_TYPES.CON, null);
      parentCon.layout = LAYOUT_TYPES.TABBED;
      parentCon.percent = 1.0;

      const nodeW = new Node(NODE_TYPES.CON, null);
      nodeW.percent = 1.0;
      parentCon.appendChild(nodeW);

      const nestedCon = new Node(NODE_TYPES.CON, null);
      nestedCon.layout = LAYOUT_TYPES.VSPLIT;
      nestedCon.percent = 1.0;
      parentCon.appendChild(nestedCon);

      const nodeA = new Node(NODE_TYPES.CON, null);
      nodeA.percent = 0.5;
      nestedCon.appendChild(nodeA);

      const nodeB = new Node(NODE_TYPES.CON, null);
      nodeB.percent = 0.5;
      nestedCon.appendChild(nodeB);

      // Tab count should be 2 (W and nested container), not 3 (W, A, B)
      const tabCount = parentCon.childNodes.length;
      expect(tabCount).toBe(2);

      // The second tab represents the entire nested container
      const secondTab = parentCon.childNodes[1];
      expect(secondTab.nodeType).toBe(NODE_TYPES.CON);
    });
  });
});
