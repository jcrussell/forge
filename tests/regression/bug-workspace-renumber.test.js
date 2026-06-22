import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import * as Utils from "../../lib/extension/utils.js";

/**
 * Bug: Workspace Index Renumbering on Add/Remove
 *
 * Problem: When GNOME Shell removes a workspace (e.g., middle workspace closed),
 * it renumbers the remaining workspaces. But Forge's tree uses string-based IDs
 * (ws0, ws1, mo0ws0, etc.) that don't get renumbered, causing findNode() lookups
 * to fail and windows to become orphaned in the tree.
 *
 * Example: Workspaces [0,1,2] exist. User closes all windows on ws1. GNOME removes
 * it and renumbers to [0,1]. Tree has ws0 and ws2 (ws1 removed). Windows on old ws2
 * now report index 1, but findNode("mo0ws1") returns null.
 *
 * Fix: After workspace removal, decrement indices of all workspace and monitor nodes
 * with index > removedIndex. After workspace addition at non-end position, increment
 * indices of nodes >= insertedIndex.
 */
describe("Bug: Workspace index renumbering on add/remove", () => {
  let ctx;
  let tree;

  beforeEach(() => {
    ctx = createTreeFixture({
      globals: {
        workspaceManager: { workspaceCount: 3, activeWorkspaceIndex: 0 },
      },
      fullExtWm: true,
    });
    tree = ctx.tree;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("After removing middle workspace", () => {
    it("should renumber workspace nodes so windows on old ws2 are findable via mo0ws1", () => {
      // Verify initial 3-workspace tree: ws0, ws1, ws2 each with mo0wsN
      const { monitor: mon0ws0 } = getWorkspaceAndMonitor(ctx, 0, 0);
      const { monitor: mon0ws1 } = getWorkspaceAndMonitor(ctx, 1, 0);
      const { monitor: mon0ws2 } = getWorkspaceAndMonitor(ctx, 2, 0);

      mon0ws0.layout = LAYOUT_TYPES.HSPLIT;
      mon0ws0.rect = { x: 0, y: 0, width: 1920, height: 1080 };
      mon0ws1.layout = LAYOUT_TYPES.HSPLIT;
      mon0ws1.rect = { x: 0, y: 0, width: 1920, height: 1080 };
      mon0ws2.layout = LAYOUT_TYPES.HSPLIT;
      mon0ws2.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      // Create windows on ws0 and ws2
      const winA = createMockWindow({ id: "A" });
      winA._workspace = ctx.workspaces[0];
      winA._monitor = 0;
      const nodeA = tree.createNode(mon0ws0.nodeValue, NODE_TYPES.WINDOW, winA);
      nodeA.mode = WINDOW_MODES.TILE;

      const winB = createMockWindow({ id: "B" });
      winB._workspace = ctx.workspaces[2];
      winB._monitor = 0;
      const nodeB = tree.createNode(mon0ws2.nodeValue, NODE_TYPES.WINDOW, winB);
      nodeB.mode = WINDOW_MODES.TILE;

      // Verify initial state
      expect(tree.findNode("ws0")).not.toBeNull();
      expect(tree.findNode("ws1")).not.toBeNull();
      expect(tree.findNode("ws2")).not.toBeNull();
      expect(tree.findNode("mo0ws0")).not.toBeNull();
      expect(tree.findNode("mo0ws1")).not.toBeNull();
      expect(tree.findNode("mo0ws2")).not.toBeNull();

      // Simulate GNOME removing workspace 1 (middle):
      // 1. Remove the workspace node
      tree.removeWorkspace(1);

      // 2. Renumber remaining workspaces
      tree.workspaceManager.renumberWorkspacesAfterRemoval(1);

      // After renumbering: ws0 stays ws0, old ws2 becomes ws1
      expect(tree.findNode("ws0")).not.toBeNull();
      expect(tree.findNode("ws1")).not.toBeNull();
      expect(tree.findNode("ws2")).toBeNull(); // Should no longer exist

      // Monitor nodes should also be renumbered
      expect(tree.findNode("mo0ws0")).not.toBeNull();
      expect(tree.findNode("mo0ws1")).not.toBeNull();
      expect(tree.findNode("mo0ws2")).toBeNull();

      // Window B should be findable via the renumbered monitor node
      const renumberedMon = tree.findNode("mo0ws1");
      expect(renumberedMon).not.toBeNull();
      expect(renumberedMon.childNodes).toContain(nodeB);
    });

    it("should preserve window layout after renumbering", () => {
      const { monitor: mon0ws2 } = getWorkspaceAndMonitor(ctx, 2, 0);
      mon0ws2.layout = LAYOUT_TYPES.HSPLIT;
      mon0ws2.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      // Create two windows on ws2 with explicit proportions
      const winB = createMockWindow({ id: "B" });
      winB._workspace = ctx.workspaces[2];
      winB._monitor = 0;
      const nodeB = tree.createNode(mon0ws2.nodeValue, NODE_TYPES.WINDOW, winB);
      nodeB.mode = WINDOW_MODES.TILE;
      nodeB.percent = 0.6;

      const winC = createMockWindow({ id: "C" });
      winC._workspace = ctx.workspaces[2];
      winC._monitor = 0;
      const nodeC = tree.createNode(mon0ws2.nodeValue, NODE_TYPES.WINDOW, winC);
      nodeC.mode = WINDOW_MODES.TILE;
      nodeC.percent = 0.4;

      // Remove middle workspace and renumber
      tree.removeWorkspace(1);
      tree.workspaceManager.renumberWorkspacesAfterRemoval(1);

      // Window proportions should be preserved
      expect(nodeB.percent).toBe(0.6);
      expect(nodeC.percent).toBe(0.4);

      // The monitor node should still contain both windows
      const renumberedMon = tree.findNode("mo0ws1");
      expect(renumberedMon.childNodes.length).toBe(2);
      expect(renumberedMon.childNodes).toContain(nodeB);
      expect(renumberedMon.childNodes).toContain(nodeC);
    });
  });

  describe("After removing first workspace", () => {
    it("should renumber all remaining workspace and monitor nodes", () => {
      // Remove ws0 (index 0)
      tree.removeWorkspace(0);
      tree.workspaceManager.renumberWorkspacesAfterRemoval(0);

      // Old ws1 -> ws0, old ws2 -> ws1
      expect(tree.findNode("ws0")).not.toBeNull();
      expect(tree.findNode("ws1")).not.toBeNull();
      expect(tree.findNode("ws2")).toBeNull();

      expect(tree.findNode("mo0ws0")).not.toBeNull();
      expect(tree.findNode("mo0ws1")).not.toBeNull();
      expect(tree.findNode("mo0ws2")).toBeNull();
    });
  });

  describe("After adding workspace at non-end position", () => {
    it("should shift existing nodes up to make room", () => {
      // Verify initial state: ws0, ws1, ws2
      expect(tree.findNode("ws0")).not.toBeNull();
      expect(tree.findNode("ws1")).not.toBeNull();
      expect(tree.findNode("ws2")).not.toBeNull();

      // Simulate adding workspace at index 1 (ws1 already exists)
      tree.workspaceManager.renumberWorkspacesAfterAddition(1);

      // ws0 stays, old ws1->ws2, old ws2->ws3
      expect(tree.findNode("ws0")).not.toBeNull();
      expect(tree.findNode("ws2")).not.toBeNull();
      expect(tree.findNode("ws3")).not.toBeNull();
      // ws1 slot should now be free for the new workspace
      expect(tree.findNode("ws1")).toBeNull();

      expect(tree.findNode("mo0ws0")).not.toBeNull();
      expect(tree.findNode("mo0ws2")).not.toBeNull();
      expect(tree.findNode("mo0ws3")).not.toBeNull();
      expect(tree.findNode("mo0ws1")).toBeNull();
    });
  });

  // forge-2jxz: the per-workspace window-added signal IDs are keyed by workspace
  // index in _workspaceSignals and must follow the node renumber, or disable()
  // can never disconnect them. This guards the (previously untested) signal-map
  // rekey, including the atomic two-phase apply that keeps it order-independent.
  describe("signal-map rekey on renumber", () => {
    it("moves tracked signal IDs to the new index on removal, losing none", () => {
      const signals = tree.workspaceManager._workspaceSignals;
      const ws0 = [101];
      const ws2 = [201, 202];
      signals.set(0, ws0);
      signals.set(2, ws2);

      tree.removeWorkspace(1);
      tree.workspaceManager.renumberWorkspacesAfterRemoval(1);

      // ws0 stays put; old ws2's signals move to ws1; nothing left at index 2.
      expect(signals.get(0)).toBe(ws0);
      expect(signals.get(1)).toBe(ws2);
      expect(signals.has(2)).toBe(false);
    });

    it("shifts tracked signal IDs up on addition without overwriting a live array", () => {
      const signals = tree.workspaceManager._workspaceSignals;
      const ws1 = [111];
      const ws2 = [211];
      signals.set(1, ws1);
      signals.set(2, ws2);

      tree.workspaceManager.renumberWorkspacesAfterAddition(1);

      // old ws1->ws2, old ws2->ws3; both arrays preserved, ws1 slot freed.
      expect(signals.get(2)).toBe(ws1);
      expect(signals.get(3)).toBe(ws2);
      expect(signals.has(1)).toBe(false);
    });
  });
});
