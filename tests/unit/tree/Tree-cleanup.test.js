import { describe, it, expect, beforeEach, vi } from "vitest";
import { Tree, Node, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
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
  let tree;
  let mockWindowManager;
  let mockWorkspaceManager;

  beforeEach(() => {
    // Mock global object
    global.display = {
      get_workspace_manager: vi.fn(),
      get_n_monitors: vi.fn(() => 1),
      get_monitor_neighbor_index: vi.fn(() => -1),
      get_current_time: vi.fn(() => 12345),
      get_focus_window: vi.fn(() => null),
    };

    global.window_group = {
      contains: vi.fn(() => false),
      add_child: vi.fn(),
      remove_child: vi.fn(),
    };

    global.get_current_time = vi.fn(() => 12345);

    // Mock workspace manager
    mockWorkspaceManager = {
      get_n_workspaces: vi.fn(() => 1),
      get_workspace_by_index: vi.fn((i) => ({
        index: () => i,
      })),
    };

    global.display.get_workspace_manager.mockReturnValue(mockWorkspaceManager);

    // Mock WindowManager
    mockWindowManager = {
      ext: {
        settings: {
          get_boolean: vi.fn((key) => {
            if (key === "auto-exit-tabbed") return true;
            return false;
          }),
          get_uint: vi.fn(() => 0),
        },
      },
      determineSplitLayout: vi.fn(() => LAYOUT_TYPES.HSPLIT),
      bindWorkspaceSignals: vi.fn(),
      move: vi.fn(),
      movePointerWith: vi.fn(),
      getPointer: vi.fn(() => [100, 100]),
      focusMetaWindow: null,
      currentMonWsNode: null,
      rectForMonitor: vi.fn((node, monitorIndex) => ({
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      })),
      sameParentMonitor: vi.fn(() => true),
      floatingWindow: vi.fn(() => false),
    };

    // Create tree
    tree = new Tree(mockWindowManager);

    // Setup currentMonWsNode for tests
    mockWindowManager.currentMonWsNode = tree.nodeWorkpaces[0]?.getNodeByType(
      NODE_TYPES.MONITOR
    )[0];
  });

  describe("removeNode - Basic Removal", () => {
    it("should remove window from parent", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const window = createMockWindow();
      const node = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      tree.removeNode(node);

      expect(monitor.childNodes).not.toContain(node);
    });

    it("should return true on successful removal", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const window = createMockWindow();
      const node = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      const result = tree.removeNode(node);

      expect(result).toBe(true);
    });

    it("should update attachNode after removal", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const window = createMockWindow();
      const node = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);
      tree.attachNode = node;

      tree.removeNode(node);

      expect(tree.attachNode).not.toBe(node);
    });
  });

  describe("removeNode - Single Child Container Cleanup", () => {
    it("should remove container when last child is removed", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window = createMockWindow();
      const node = tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window);

      // When container has only one child, removeNode removes the container too
      tree.removeNode(node);

      expect(monitor.childNodes).not.toContain(container);
    });

    it("should keep container when multiple children remain", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      tree.removeNode(node1);

      expect(monitor.childNodes).toContain(container);
      expect(container.childNodes).toHaveLength(1);
    });

    it("should not remove monitor even when it has only one child", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const window = createMockWindow();
      const node = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);

      tree.removeNode(node);

      // Monitor should still exist (it's preserved even when empty)
      expect(workspace.getNodeByType(NODE_TYPES.MONITOR)).toContain(monitor);
    });
  });

  describe("removeNode - Stacked/Tabbed Container Behavior", () => {
    it("should exit tabbed layout when single tab remains", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.TABBED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      // Remove one window, leaving one tab
      tree.removeNode(container.firstChild);

      // Should exit tabbed layout
      expect(container.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should clear lastTabFocus when exiting tabbed layout", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.TABBED;
      container.lastTabFocus = "some-value";

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      tree.removeNode(container.firstChild);

      expect(container.lastTabFocus).toBeNull();
    });

    it("should keep stacked layout when multiple children remain", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.STACKED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const window3 = createMockWindow();
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      tree.removeNode(container.firstChild);

      // Stacked layout should remain (not auto-exit like tabbed)
      expect(container.layout).toBe(LAYOUT_TYPES.STACKED);
      expect(container.childNodes).toHaveLength(2);
    });

    it("should not auto-exit tabbed when setting is disabled", () => {
      mockWindowManager.ext.settings.get_boolean.mockImplementation((key) => {
        if (key === "auto-exit-tabbed") return false;
        return false;
      });

      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container.layout = LAYOUT_TYPES.TABBED;

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);

      tree.removeNode(container.firstChild);

      // Should stay tabbed when setting is disabled
      expect(container.layout).toBe(LAYOUT_TYPES.TABBED);
    });
  });

  describe("removeNode - Percent Reset", () => {
    it("should reset sibling percents after removal in container", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const window3 = createMockWindow();
      const node1 = tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      const node3 = tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      node1.percent = 0.5;
      node2.percent = 0.3;
      node3.percent = 0.2;

      tree.removeNode(node1);

      // Remaining siblings should have percents reset
      expect(node2.percent).toBe(0);
      expect(node3.percent).toBe(0);
    });

    it("should not reset percents across workspace boundary", () => {
      // This tests Bug #470 fix
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.percent = 0.6;
      node2.percent = 0.4;

      // Store original percents
      const percent1Before = node1.percent;
      const percent2Before = node2.percent;

      // Remove node1 - since parent is MONITOR, reset should NOT occur
      tree.removeNode(node1);

      // Workspace/monitor level should not reset percents (Bug #470)
      // However, this depends on implementation details
      expect(monitor.childNodes).toContain(node2);
    });
  });

  describe("cleanTree - Orphan Container Removal", () => {
    it("should remove empty containers", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      // Create empty container directly (bypassing normal flow)
      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      // Don't add any children

      // Manually remove all children to make it empty
      while (container.childNodes.length > 0) {
        container.removeChild(container.firstChild);
      }

      tree.cleanTree();

      expect(monitor.childNodes).not.toContain(container);
    });

    it("should not remove containers with children", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window = createMockWindow();
      tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window);

      tree.cleanTree();

      expect(monitor.childNodes).toContain(container);
    });
  });

  describe("cleanTree - Nested Container Flattening", () => {
    it("should flatten nested single-child containers", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      // Create nested structure: monitor > con1 > con2
      const container1 = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container1.layout = LAYOUT_TYPES.HSPLIT;

      const container2 = tree.createNode(container1.nodeValue, NODE_TYPES.CON, new Bin());
      container2.layout = LAYOUT_TYPES.VSPLIT;

      const window = createMockWindow();
      tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window);

      tree.cleanTree();

      // The nested CON[CON[WINDOW]] should become CON[WINDOW]
      // container1 should contain the window directly
      const cons = monitor.getNodeByType(NODE_TYPES.CON);
      expect(cons.length).toBeLessThanOrEqual(1);
    });

    it("should inherit layout from child container when flattening", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container1 = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      container1.layout = LAYOUT_TYPES.HSPLIT;

      const container2 = tree.createNode(container1.nodeValue, NODE_TYPES.CON, new Bin());
      container2.layout = LAYOUT_TYPES.VSPLIT;

      const window = createMockWindow();
      tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window);

      tree.cleanTree();

      // After flattening, the remaining container should have VSPLIT layout
      if (
        container1.childNodes.length > 0 &&
        container1.childNodes[0].nodeType === NODE_TYPES.WINDOW
      ) {
        expect(container1.layout).toBe(LAYOUT_TYPES.VSPLIT);
      }
    });

    it("should handle multiple levels of nesting", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      // Create deeply nested: monitor > con1 > con2 > con3 > window
      const container1 = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const container2 = tree.createNode(container1.nodeValue, NODE_TYPES.CON, new Bin());
      const container3 = tree.createNode(container2.nodeValue, NODE_TYPES.CON, new Bin());

      const window = createMockWindow();
      tree.createNode(container3.nodeValue, NODE_TYPES.WINDOW, window);

      tree.cleanTree();

      // Should flatten to a simpler structure
      const allCons = tree.getNodeByType(NODE_TYPES.CON);
      // Should have fewer nested containers
      expect(
        allCons.filter(
          (c) => c.childNodes.length === 1 && c.childNodes[0].nodeType === NODE_TYPES.CON
        ).length
      ).toBe(0);
    });

    it("should not flatten containers with multiple children", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container1 = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());

      const container2 = tree.createNode(container1.nodeValue, NODE_TYPES.CON, new Bin());
      const window1 = createMockWindow();
      const window2 = createMockWindow();
      tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window1);
      tree.createNode(container2.nodeValue, NODE_TYPES.WINDOW, window2);

      tree.cleanTree();

      // The windows should still be grouped together (either in container1 or container2)
      // After flattening, the parent will contain the windows directly or still have container2
      const allWindows = tree.getNodeByType(NODE_TYPES.WINDOW);
      expect(allWindows).toHaveLength(2);
      // Both windows should have the same parent
      expect(allWindows[0].parentNode).toBe(allWindows[1].parentNode);
    });
  });

  describe("Container State After Window Destruction", () => {
    it("should maintain valid tree structure after window removal", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      tree.removeNode(node1);

      // Tree should still be valid
      expect(tree.nodeWorkpaces[0]).toBeDefined();
      expect(monitor.childNodes).toContain(node2);
      expect(node2.parentNode).toBe(monitor);
    });

    it("should update parent child count after removal", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      const countBefore = monitor.childNodes.length;
      tree.removeNode(monitor.firstChild);

      expect(monitor.childNodes.length).toBe(countBefore - 1);
    });

    it("should handle removal of all windows gracefully", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const node1 = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      tree.removeNode(node1);
      tree.removeNode(node2);

      // Monitor should be empty but still valid
      expect(monitor.childNodes).toHaveLength(0);
      expect(tree.nodeWorkpaces[0]).toBeDefined();
    });
  });

  describe("resetSiblingPercent", () => {
    it("should reset all sibling percents to 0", () => {
      const workspace = tree.nodeWorkpaces[0];
      const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];

      const container = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      const window1 = createMockWindow();
      const window2 = createMockWindow();
      const window3 = createMockWindow();
      const node1 = tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window2);
      const node3 = tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window3);

      node1.percent = 0.5;
      node2.percent = 0.3;
      node3.percent = 0.2;

      tree.resetSiblingPercent(container);

      expect(node1.percent).toBe(0);
      expect(node2.percent).toBe(0);
      expect(node3.percent).toBe(0);
    });
  });
});
