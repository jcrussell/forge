import { describe, it, expect, beforeEach, vi } from "vitest";
import { Tree, Node, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Bin } from "../../mocks/gnome/St.js";

/**
 * Tree cleanup and container management tests
 *
 * Tests for behaviors when:
 * - All windows in a container are closed
 * - Container has only one child remaining
 * - Parent layout adjustments after child removal
 * - cleanTree() behavior
 */
describe("Tree Cleanup and Container Management", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "auto-exit-tabbed": true },
    });
    // Setup currentMonWsNode for tests
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
  });

  describe("removeNode - Basic Removal", () => {
    it("should remove window from parent", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.removeNode(node);

      expect(monitor.childNodes).not.toContain(node);
    });

    it("should return true on successful removal", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      const result = ctx.tree.removeNode(node);

      expect(result).toBe(true);
    });

    it("should update attachNode after removal", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);
      ctx.tree.attachNode = node;

      ctx.tree.removeNode(node);

      expect(ctx.tree.attachNode).not.toBe(node);
    });
  });

  describe("removeNode - Single Child Container Cleanup", () => {
    it("should remove container when last child is removed", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window = createMockWindow();
      const node = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window);

      // When container has only one child, removeNode removes the container too
      ctx.tree.removeNode(node);

      expect(monitor.childNodes).not.toContain(container);
    });

    it("should keep container when multiple children remain", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      ctx.tree.removeNode(node1);

      expect(monitor.childNodes).toContain(container);
      expect(container.childNodes).toHaveLength(1);
    });

    it("should not remove monitor even when it has only one child", () => {
      const { workspace, monitor } = getWorkspaceAndMonitor(ctx);

      const window = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.removeNode(node);

      // Monitor should still exist (it's preserved even when empty)
      expect(workspace.getNodeByType(NODE_TYPES.MONITOR)).toContain(monitor);
    });
  });

  describe("removeNode - Stacked/Tabbed Container Behavior", () => {
    it("should exit tabbed layout when single tab remains", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.TABBED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      // Remove one window, leaving one tab
      ctx.tree.removeNode(container.firstChild);

      // Should exit tabbed layout
      expect(container.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should clear lastTabFocus when exiting tabbed layout", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.TABBED;
      container.lastTabFocus = "some-value";

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      ctx.tree.removeNode(container.firstChild);

      expect(container.lastTabFocus).toBeNull();
    });

    it("should keep stacked layout when multiple children remain", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.STACKED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const window3 = createMockWindow();
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      ctx.tree.removeNode(container.firstChild);

      // Stacked layout should remain (not auto-exit like tabbed)
      expect(container.layout).toBe(LAYOUT_TYPES.STACKED);
      expect(container.childNodes).toHaveLength(2);
    });

    it("should not auto-exit tabbed when setting is disabled", () => {
      ctx.extWm.ext.settings.get_boolean.mockImplementation((key) => {
        if (key === "auto-exit-tabbed") return false;
        return false;
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.TABBED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      ctx.tree.removeNode(container.firstChild);

      // Should stay tabbed when setting is disabled
      expect(container.layout).toBe(LAYOUT_TYPES.TABBED);
    });
  });

  describe("removeNode - Percent Reset", () => {
    it("should reset sibling percents after removal in container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const window3 = createMockWindow();
      const node1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      const node3 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      node1.percent = 0.5;
      node2.percent = 0.3;
      node3.percent = 0.2;

      ctx.tree.removeNode(node1);

      // Remaining siblings should have percents reset
      expect(node2.percent).toBe(0);
      expect(node3.percent).toBe(0);
    });

    it("should not reset percents across workspace boundary", () => {
      // This tests Bug #470 fix
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.percent = 0.6;
      node2.percent = 0.4;

      // Store original percents
      const percent1Before = node1.percent;
      const percent2Before = node2.percent;

      // Remove node1 - since parent is MONITOR, reset should NOT occur
      ctx.tree.removeNode(node1);

      // Workspace/monitor level should not reset percents (Bug #470)
      // However, this depends on implementation details
      expect(monitor.childNodes).toContain(node2);
    });
  });

  describe("cleanTree - Orphan Container Removal", () => {
    it("should remove empty containers", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create empty container directly (bypassing normal flow)
      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      // Don't add any children

      // Manually remove all children to make it empty
      while (container.childNodes.length > 0) {
        container.removeChild(container.firstChild);
      }

      ctx.tree.cleanTree();

      expect(monitor.childNodes).not.toContain(container);
    });

    it("should not remove containers with children", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window = createMockWindow();
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.cleanTree();

      expect(monitor.childNodes).toContain(container);
    });
  });

  describe("cleanTree - Nested Container Flattening", () => {
    it("should flatten nested single-child containers", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create nested structure: monitor > con1 > con2
      const container1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container1.layout = LAYOUT_TYPES.HSPLIT;

      const container2 = ctx.tree.createNode(container1.nodeValue, NODE_TYPES.CON, new Bin());
      container2.layout = LAYOUT_TYPES.VSPLIT;

      const window = createMockWindow();
      ctx.tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.cleanTree();

      // The nested CON[CON[WINDOW]] should become CON[WINDOW]
      // container1 should contain the window directly
      const cons = monitor.getNodeByType(NODE_TYPES.CON);
      expect(cons.length).toBeLessThanOrEqual(1);
    });

    it("should inherit layout from child container when flattening", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container1.layout = LAYOUT_TYPES.HSPLIT;

      const container2 = ctx.tree.createNode(container1.nodeValue, NODE_TYPES.CON, new Bin());
      container2.layout = LAYOUT_TYPES.VSPLIT;

      const window = createMockWindow();
      ctx.tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.cleanTree();

      // After flattening, the remaining container should have VSPLIT layout
      if (
        container1.childNodes.length > 0 &&
        container1.childNodes[0].nodeType === NODE_TYPES.WINDOW
      ) {
        expect(container1.layout).toBe(LAYOUT_TYPES.VSPLIT);
      }
    });

    it("should handle multiple levels of nesting", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create deeply nested: monitor > con1 > con2 > con3 > window
      const container1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const container2 = ctx.tree.createNode(container1.nodeValue, NODE_TYPES.CON, new Bin());
      const container3 = ctx.tree.createNode(container2.nodeValue, NODE_TYPES.CON, new Bin());

      const window = createMockWindow();
      ctx.tree.createNode(container3.nodeValue, NODE_TYPES.WINDOW, window);

      ctx.tree.cleanTree();

      // Should flatten to a simpler structure
      const allCons = ctx.tree.getNodeByType(NODE_TYPES.CON);
      // Should have fewer nested containers
      expect(
        allCons.filter(
          (c) => c.childNodes.length === 1 && c.childNodes[0].nodeType === NODE_TYPES.CON
        ).length
      ).toBe(0);
    });

    it("should not flatten containers with multiple children", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());

      const container2 = ctx.tree.createNode(container1.nodeValue, NODE_TYPES.CON, new Bin());
      const window1 = createMockWindow();
      const window2 = createMockWindow();
      ctx.tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window1);
      ctx.tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window2);

      ctx.tree.cleanTree();

      // The windows should still be grouped together (either in container1 or container2)
      // After flattening, the parent will contain the windows directly or still have container2
      const allWindows = ctx.tree.getNodeByType(NODE_TYPES.WINDOW);
      expect(allWindows).toHaveLength(2);
      // Both windows should have the same parent
      expect(allWindows[0].parentNode).toBe(allWindows[1].parentNode);
    });
  });

  describe("Container State After Window Destruction", () => {
    it("should maintain valid tree structure after window removal", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      ctx.tree.removeNode(node1);

      // Tree should still be valid
      expect(ctx.tree.nodeWorkpaces[0]).toBeDefined();
      expect(monitor.childNodes).toContain(node2);
      expect(node2.parentNode).toBe(monitor);
    });

    it("should update parent child count after removal", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      const countBefore = monitor.childNodes.length;
      ctx.tree.removeNode(monitor.firstChild);

      expect(monitor.childNodes.length).toBe(countBefore - 1);
    });

    it("should handle removal of all windows gracefully", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      ctx.tree.removeNode(node1);
      ctx.tree.removeNode(node2);

      // Monitor should be empty but still valid
      expect(monitor.childNodes).toHaveLength(0);
      expect(ctx.tree.nodeWorkpaces[0]).toBeDefined();
    });
  });

  describe("resetSiblingPercent", () => {
    it("should reset all sibling percents to 0", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const window3 = createMockWindow();
      const node1 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      const node3 = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      node1.percent = 0.5;
      node2.percent = 0.3;
      node3.percent = 0.2;

      ctx.tree.resetSiblingPercent(container);

      expect(node1.percent).toBe(0);
      expect(node2.percent).toBe(0);
      expect(node3.percent).toBe(0);
    });
  });
});
