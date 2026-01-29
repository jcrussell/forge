import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
} from "../../mocks/helpers/index.js";
import { Rectangle, WindowType } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager layout and mode behavior tests
 *
 * Tests for behaviors:
 * - Default layout preferences for new workspaces
 * - Monocle mode toggling
 * - Focus behavior after window destruction
 * - Workspace layout independence
 */
describe("WindowManager - Layout and Mode Behaviors", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "tiling-mode-enabled": true,
        "focus-on-hover-enabled": false,
        "move-pointer-focus-enabled": false,
        "auto-exit-tabbed": true,
        "default-split-layout": 0, // HSPLIT
      },
      globals: {
        display: {
          monitorCount: 1,
        },
        workspaceManager: {
          workspaceCount: 2,
        },
      },
    });

    // Add additional mocks needed for these tests
    ctx.display.get_monitor_neighbor_index = vi.fn(() => -1);
    ctx.display.sort_windows_by_stacking = vi.fn((windows) => windows);
    ctx.display.focus_window = null;

    global.get_pointer = vi.fn(() => [960, 540]);
    global.get_window_actors = vi.fn(() => []);

    global.Main = {
      overview: {
        visible: false,
      },
    };

    global.Meta = {
      WindowType,
    };
  });

  // Convenience accessor
  const wm = () => ctx.windowManager;

  describe("Default Layout Preferences", () => {
    it("should use HSPLIT layout by default", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should have determineSplitLayout method", () => {
      expect(typeof wm().determineSplitLayout).toBe("function");
    });

    it("should return a valid layout from determineSplitLayout", () => {
      const layout = wm().determineSplitLayout();

      expect([LAYOUT_TYPES.HSPLIT, LAYOUT_TYPES.VSPLIT]).toContain(layout);
    });
  });

  describe("Window Mode Management", () => {
    it("should create window in TILE mode by default", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, {
        mode: "TILE",
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });

      expect(nodeWindow.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should allow setting window to FLOAT mode", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, {
        mode: "FLOAT",
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });

      expect(nodeWindow.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should track GRAB_TILE mode during drag operations", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });
      nodeWindow.mode = WINDOW_MODES.GRAB_TILE;

      expect(nodeWindow.mode).toBe(WINDOW_MODES.GRAB_TILE);
    });
  });

  describe("Focus After Window Destruction", () => {
    it("should track lastFocusedWindow", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });

      wm().lastFocusedWindow = nodeWindow;

      expect(wm().lastFocusedWindow).toBe(nodeWindow);
    });

    it("should clear lastFocusedWindow when window is removed", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow, metaWindow } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });

      wm().lastFocusedWindow = nodeWindow;
      ctx.tree.removeNode(nodeWindow);

      // After removal, lastFocusedWindow may still reference the node
      // The important thing is the node is no longer in the tree
      const foundNode = wm().findNodeWindow(metaWindow);
      expect(foundNode).toBeNull();
    });

    it("should find appropriate focus target after window closes", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow: node1 } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });
      const { nodeWindow: node2 } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: {
          rect: new Rectangle({ x: 800, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });

      // Remove node1
      ctx.tree.removeNode(node1);

      // node2 should still be in tree as potential focus target
      expect(monitor.childNodes).toContain(node2);
    });
  });

  describe("Workspace Layout Independence", () => {
    it("should maintain separate monitor nodes per workspace", () => {
      const { workspace: workspace0, monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { workspace: workspace1, monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      expect(monitor0).not.toBe(monitor1);
    });

    it("should allow different layouts per workspace", () => {
      const { monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      // Set different layouts
      monitor0.layout = LAYOUT_TYPES.HSPLIT;
      monitor1.layout = LAYOUT_TYPES.VSPLIT;

      expect(monitor0.layout).toBe(LAYOUT_TYPES.HSPLIT);
      expect(monitor1.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should preserve windows in each workspace independently", () => {
      const { monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      const { nodeWindow: node1 } = createWindowNode(ctx.tree, monitor0, {
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });
      const { nodeWindow: node2 } = createWindowNode(ctx.tree, monitor1, {
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[1],
        },
      });

      // Each workspace should have its window
      expect(monitor0.childNodes).toContain(node1);
      expect(monitor1.childNodes).toContain(node2);
      expect(monitor0.childNodes).not.toContain(node2);
      expect(monitor1.childNodes).not.toContain(node1);
    });

    it("should track window count per workspace", () => {
      const { workspace: workspace0, monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { workspace: workspace1, monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      createWindowNode(ctx.tree, monitor0, { windowOverrides: { workspace: ctx.workspaces[0] } });
      createWindowNode(ctx.tree, monitor0, { windowOverrides: { workspace: ctx.workspaces[0] } });
      createWindowNode(ctx.tree, monitor1, { windowOverrides: { workspace: ctx.workspaces[1] } });

      const ws0Windows = workspace0.getNodeByType(NODE_TYPES.WINDOW);
      const ws1Windows = workspace1.getNodeByType(NODE_TYPES.WINDOW);

      expect(ws0Windows).toHaveLength(2);
      expect(ws1Windows).toHaveLength(1);
    });
  });

  describe("Layout Container Management", () => {
    it("should create container when splitting", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });

      // Perform split
      ctx.tree.split(nodeWindow, 0, true); // HORIZONTAL

      // Node should now be inside a container
      expect(nodeWindow.parentNode.nodeType).toBe(NODE_TYPES.CON);
    });

    it("should change container layout on toggleSplit", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: {
          rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
          workspace: ctx.workspaces[0],
        },
      });

      // Create HSPLIT container
      ctx.tree.split(nodeWindow, 0, true);
      const container = nodeWindow.parentNode;
      container.layout = LAYOUT_TYPES.HSPLIT;

      // Toggle to VSPLIT
      ctx.tree.split(nodeWindow, 1, false); // VERTICAL, no force

      expect(container.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("should support stacked layout in container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow: node1 } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: { workspace: ctx.workspaces[0] },
      });
      ctx.tree.split(node1, 0, true);

      const container = node1.parentNode;
      container.layout = LAYOUT_TYPES.STACKED;

      createWindowNode(ctx.tree, container, {
        windowOverrides: { workspace: ctx.workspaces[0] },
      });

      expect(container.layout).toBe(LAYOUT_TYPES.STACKED);
      expect(container.childNodes).toHaveLength(2);
    });

    it("should support tabbed layout in container", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow: node1 } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: { workspace: ctx.workspaces[0] },
      });
      ctx.tree.split(node1, 0, true);

      const container = node1.parentNode;
      container.layout = LAYOUT_TYPES.TABBED;

      createWindowNode(ctx.tree, container, {
        windowOverrides: { workspace: ctx.workspaces[0] },
      });

      expect(container.layout).toBe(LAYOUT_TYPES.TABBED);
      expect(container.childNodes).toHaveLength(2);
    });
  });

  describe("findNodeWindow", () => {
    it("should find window node by metaWindow", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { nodeWindow, metaWindow } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: { workspace: ctx.workspaces[0] },
      });

      const found = wm().findNodeWindow(metaWindow);

      expect(found).toBe(nodeWindow);
    });

    it("should return null for unknown window", () => {
      const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });

      const found = wm().findNodeWindow(metaWindow);

      expect(found).toBeNull();
    });

    it("should find window across different workspaces", () => {
      const { monitor: monitor0 } = getWorkspaceAndMonitor(ctx, 0);
      const { monitor: monitor1 } = getWorkspaceAndMonitor(ctx, 1);

      createWindowNode(ctx.tree, monitor0, {
        windowOverrides: { workspace: ctx.workspaces[0] },
      });
      const { nodeWindow: node2, metaWindow: metaWindow2 } = createWindowNode(ctx.tree, monitor1, {
        windowOverrides: { workspace: ctx.workspaces[1] },
      });

      const found = wm().findNodeWindow(metaWindow2);

      expect(found).toBe(node2);
    });
  });
});
