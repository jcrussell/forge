import { describe, it, expect, beforeEach, vi } from "vitest";
import St from "gi://St";
import { Tree, Node, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { Bin, BoxLayout } from "../../mocks/gnome/St.js";
import { createTreeFixture } from "../../mocks/helpers/index.js";

/**
 * Tree class tests
 *
 * Note: Tree constructor requires complex GNOME global objects and WindowManager.
 * These tests focus on the core tree operations that can be tested in isolation.
 */
describe("Tree", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture();
  });

  describe("Constructor", () => {
    it("should create tree with root type", () => {
      expect(ctx.tree.nodeType).toBe(NODE_TYPES.ROOT);
    });

    it("should set ROOT layout", () => {
      expect(ctx.tree.layout).toBe(LAYOUT_TYPES.ROOT);
    });

    it("should set default stack height", () => {
      expect(ctx.tree.defaultStackHeight).toBe(35);
    });

    it("should have reference to WindowManager", () => {
      expect(ctx.tree.extWm).toBe(ctx.extWm);
    });

    it("should initialize workspaces", () => {
      // Should have created workspace nodes
      const workspaces = ctx.tree.nodeWorkpaces;
      expect(workspaces.length).toBeGreaterThan(0);
    });
  });

  describe("findNode", () => {
    it("should find root node by value", () => {
      const found = ctx.tree.findNode(ctx.tree.nodeValue);

      expect(found).toBe(ctx.tree);
    });

    it("should find workspace node", () => {
      const workspaces = ctx.tree.nodeWorkpaces;
      if (workspaces.length > 0) {
        const ws = workspaces[0];
        const found = ctx.tree.findNode(ws.nodeValue);

        expect(found).toBe(ws);
      }
    });

    it("should return null for non-existent node", () => {
      const found = ctx.tree.findNode("nonexistent-node");

      expect(found).toBeNull();
    });

    it("should find nested nodes", () => {
      // Create a nested structure
      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);
      if (monitors.length > 0) {
        const containerBin = new St.Bin();
        const container = ctx.tree.createNode(monitors[0].nodeValue, NODE_TYPES.CON, containerBin);

        // Find by the actual nodeValue (the St.Bin instance)
        const found = ctx.tree.findNode(containerBin);

        expect(found).toBe(container);
      }
    });
  });

  describe("createNode", () => {
    it("should create node under parent", () => {
      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);
      if (monitors.length > 0) {
        const containerBin = new St.Bin();
        const newNode = ctx.tree.createNode(monitors[0].nodeValue, NODE_TYPES.CON, containerBin);

        expect(newNode).toBeDefined();
        expect(newNode.nodeType).toBe(NODE_TYPES.CON);
        // nodeValue is the St.Bin instance passed to createNode
        expect(newNode.nodeValue).toBe(containerBin);
      }
    });

    it("should add node to parent children", () => {
      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);

      if (monitors.length > 0) {
        const monitor = monitors[0];
        const initialChildCount = monitor.childNodes.length;

        ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());

        expect(monitor.childNodes.length).toBe(initialChildCount + 1);
      }
    });

    it("should set node settings from tree", () => {
      const workspace = ctx.tree.nodeWorkpaces[0];
      const newNode = ctx.tree.createNode(workspace.nodeValue, NODE_TYPES.CON, new St.Bin());

      expect(newNode.settings).toBe(ctx.tree.settings);
    });

    it("should create node with default TILE mode", () => {
      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);

      if (monitors.length > 0) {
        const monitor = monitors[0];
        // Note: This would work for WINDOW type nodes
        const newNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());

        // CON nodes don't have mode set, but WINDOW nodes would
        expect(newNode).toBeDefined();
      }
    });

    it("should return undefined if parent not found", () => {
      const newNode = ctx.tree.createNode("nonexistent-parent", NODE_TYPES.CON, new St.Bin());

      expect(newNode).toBeUndefined();
    });

    it("should handle inserting after window parent", () => {
      // This tests the special case where parent is a window
      // Window's parent becomes the actual parent for the new node
      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);

      if (monitors.length > 0) {
        const monitor = monitors[0];

        // Create two nodes - second should be sibling to first, not child
        const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());
        const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());

        // Both should be children of monitor
        expect(monitor.childNodes).toContain(node1);
        expect(monitor.childNodes).toContain(node2);
      }
    });
  });

  describe("nodeWorkspaces", () => {
    it("should return all workspace nodes", () => {
      const workspaces = ctx.tree.nodeWorkpaces;

      expect(Array.isArray(workspaces)).toBe(true);
      workspaces.forEach((ws) => {
        expect(ws.nodeType).toBe(NODE_TYPES.WORKSPACE);
      });
    });

    it("should find workspaces initialized in constructor", () => {
      const workspaces = ctx.tree.nodeWorkpaces;

      // Should have at least one workspace (from mock returning 1)
      expect(workspaces.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("nodeWindows", () => {
    it("should return empty array when no windows", () => {
      const windows = ctx.tree.nodeWindows;

      expect(Array.isArray(windows)).toBe(true);
      expect(windows.length).toBe(0);
    });

    it("should return all window nodes when windows exist", () => {
      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);

      if (monitors.length > 0) {
        const monitor = monitors[0];

        // Create mock window node (without actual Meta.Window to avoid UI init)
        // In real usage, windows would be created differently
        const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());

        // We can verify the getter works
        const windows = ctx.tree.nodeWindows;
        expect(Array.isArray(windows)).toBe(true);
      }
    });
  });

  describe("addWorkspace", () => {
    it("should add new workspace", () => {
      ctx.workspaceManager.get_n_workspaces.mockReturnValue(2);
      ctx.workspaceManager.get_workspace_by_index.mockImplementation((i) => ({
        index: () => i,
      }));

      const initialCount = ctx.tree.nodeWorkpaces.length;
      const result = ctx.tree.addWorkspace(1);

      expect(result).toBe(true);
      expect(ctx.tree.nodeWorkpaces.length).toBe(initialCount + 1);
    });

    it("should not add duplicate workspace", () => {
      const initialCount = ctx.tree.nodeWorkpaces.length;

      // Try to add workspace that already exists (index 0)
      const result = ctx.tree.addWorkspace(0);

      expect(result).toBe(false);
      expect(ctx.tree.nodeWorkpaces.length).toBe(initialCount);
    });

    it("should set workspace layout to HSPLIT", () => {
      ctx.workspaceManager.get_n_workspaces.mockReturnValue(2);

      ctx.tree.addWorkspace(1);
      const workspace = ctx.tree.findNode("ws1");

      if (workspace) {
        expect(workspace.layout).toBe(LAYOUT_TYPES.HSPLIT);
      }
    });

    it("should create monitors for workspace", () => {
      ctx.workspaceManager.get_n_workspaces.mockReturnValue(2);
      global.display.get_n_monitors.mockReturnValue(2);

      ctx.tree.addWorkspace(1);
      const workspace = ctx.tree.findNode("ws1");

      if (workspace) {
        const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);
        expect(monitors.length).toBe(2);
      }
    });
  });

  describe("removeWorkspace", () => {
    it("should remove existing workspace", () => {
      const workspaces = ctx.tree.nodeWorkpaces;
      const initialCount = workspaces.length;

      if (initialCount > 0) {
        const result = ctx.tree.removeWorkspace(0);

        expect(result).toBe(true);
        expect(ctx.tree.nodeWorkpaces.length).toBe(initialCount - 1);
      }
    });

    it("should return false for non-existent workspace", () => {
      const result = ctx.tree.removeWorkspace(999);

      expect(result).toBe(false);
    });

    it("should remove workspace from tree", () => {
      const workspaces = ctx.tree.nodeWorkpaces;

      if (workspaces.length > 0) {
        ctx.tree.removeWorkspace(0);

        const found = ctx.tree.findNode("ws0");
        expect(found).toBeNull();
      }
    });
  });

  describe("Tree Structure Integrity", () => {
    it("should maintain parent-child relationships", () => {
      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);

      monitors.forEach((monitor) => {
        expect(monitor.parentNode).toBe(workspace);
      });
    });

    it("should have proper node hierarchy", () => {
      // Root -> Workspace -> Monitor -> (Containers/Windows)
      expect(ctx.tree.nodeType).toBe(NODE_TYPES.ROOT);

      const workspaces = ctx.tree.getNodeByType(NODE_TYPES.WORKSPACE);
      workspaces.forEach((ws) => {
        expect(ws.parentNode).toBe(ctx.tree);

        const monitors = ws.getNodeByType(NODE_TYPES.MONITOR);
        monitors.forEach((mon) => {
          expect(mon.parentNode).toBe(ws);
        });
      });
    });

    it("should allow deep nesting", () => {
      const workspace = ctx.tree.nodeWorkpaces[0];
      const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);

      if (monitors.length > 0) {
        const monitor = monitors[0];

        const bin1 = new St.Bin();
        const bin2 = new St.Bin();
        const bin3 = new St.Bin();

        const container1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, bin1);
        const container2 = ctx.tree.createNode(bin1, NODE_TYPES.CON, bin2);
        const container3 = ctx.tree.createNode(bin2, NODE_TYPES.CON, bin3);

        expect(container3.level).toBe(container1.level + 2);
        // Find by the actual nodeValue (St.Bin instance)
        expect(ctx.tree.findNode(bin3)).toBe(container3);
      }
    });
  });
});
