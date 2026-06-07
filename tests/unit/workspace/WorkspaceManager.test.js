import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkspaceManager } from "../../../lib/extension/workspace.js";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { installGnomeGlobals } from "../../mocks/helpers/index.js";

/**
 * WorkspaceManager unit tests
 *
 * Tests for the WorkspaceManager class which handles workspace-related operations:
 * - addWorkspace(): Create workspace nodes in the tree
 * - removeWorkspace(): Remove workspace nodes and clean up signals
 * - bindWorkspaceSignals(): Connect window-added signal to workspace
 * - unbindWorkspaceSignals(): Disconnect signals by workspace index
 * - destroy(): Clean up all workspace signals
 */
describe("WorkspaceManager", () => {
  let workspaceManager;
  let mockTree;
  let mockExtWm;
  let workspace0;
  let workspace1;
  let ctx;

  beforeEach(() => {
    // Install GNOME globals with 2 workspaces
    ctx = installGnomeGlobals({
      workspaceManager: { workspaceCount: 2 },
    });

    // Access workspaces from ctx
    workspace0 = ctx.workspaces[0];
    workspace1 = ctx.workspaces[1];

    // Create a mock tree with minimal implementation
    mockTree = {
      nodeValue: "root",
      _nodes: new Map(),
      createNode: vi.fn((parentValue, type, nodeValue) => {
        const node = {
          nodeValue,
          nodeType: type,
          layout: null,
          actorBin: null,
          childNodes: [],
        };
        mockTree._nodes.set(nodeValue, node);
        return node;
      }),
      findNode: vi.fn((nodeValue) => mockTree._nodes.get(nodeValue) || null),
      removeChild: vi.fn((node) => {
        mockTree._nodes.delete(node.nodeValue);
      }),
      addMonitor: vi.fn(),
    };

    // Create a mock WindowManager
    mockExtWm = {
      determineSplitLayout: vi.fn(() => LAYOUT_TYPES.HSPLIT),
      updateMetaWorkspaceMonitor: vi.fn(),
      _wsWindowAddSrcId: 0,
    };

    // Create WorkspaceManager instance
    workspaceManager = new WorkspaceManager(mockTree, mockExtWm);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("addWorkspace()", () => {
    it("should create a workspace node in the tree", () => {
      const result = workspaceManager.addWorkspace(0);

      expect(result).toBe(true);
      expect(mockTree.createNode).toHaveBeenCalledWith("root", NODE_TYPES.WORKSPACE, "ws0");
    });

    it("should set workspace node layout to HSPLIT", () => {
      workspaceManager.addWorkspace(0);

      const wsNode = mockTree._nodes.get("ws0");
      expect(wsNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should create an actorBin for the workspace", () => {
      workspaceManager.addWorkspace(0);

      const wsNode = mockTree._nodes.get("ws0");
      expect(wsNode.actorBin).toBeDefined();
      expect(wsNode.actorBin.style_class).toBe("workspace-actor-bg");
    });

    it("should add actorBin to global.window_group", () => {
      workspaceManager.addWorkspace(0);

      expect(global.window_group.add_child).toHaveBeenCalled();
    });

    it("should call tree.addMonitor for the workspace", () => {
      workspaceManager.addWorkspace(0);

      expect(mockTree.addMonitor).toHaveBeenCalledWith(0);
    });

    it("should return false if workspace already exists", () => {
      // First add
      workspaceManager.addWorkspace(0);

      // Second add should return false
      const result = workspaceManager.addWorkspace(0);
      expect(result).toBe(false);
    });

    it("should bind workspace signals", () => {
      workspaceManager.addWorkspace(0);

      expect(workspaceManager._workspaceSignals.has(0)).toBe(true);
    });

    it("should handle multiple workspaces", () => {
      workspaceManager.addWorkspace(0);
      workspaceManager.addWorkspace(1);

      expect(mockTree._nodes.has("ws0")).toBe(true);
      expect(mockTree._nodes.has("ws1")).toBe(true);
      expect(workspaceManager._workspaceSignals.size).toBe(2);
    });
  });

  describe("removeWorkspace()", () => {
    beforeEach(() => {
      // Add a workspace first
      workspaceManager.addWorkspace(0);
    });

    it("should remove the workspace node from tree", () => {
      const result = workspaceManager.removeWorkspace(0);

      expect(result).toBe(true);
      expect(mockTree.removeChild).toHaveBeenCalled();
    });

    it("should remove actorBin from window_group", () => {
      // Need to set up contains to return true
      const wsNode = mockTree._nodes.get("ws0");
      global.window_group._children.push(wsNode.actorBin);
      global.window_group.contains.mockReturnValue(true);

      workspaceManager.removeWorkspace(0);

      expect(global.window_group.remove_child).toHaveBeenCalled();
    });

    it("should unbind workspace signals", () => {
      workspaceManager.removeWorkspace(0);

      expect(workspaceManager._workspaceSignals.has(0)).toBe(false);
    });

    it("should return false if workspace does not exist", () => {
      const result = workspaceManager.removeWorkspace(99);

      expect(result).toBe(false);
    });
  });

  describe("bindWorkspaceSignals()", () => {
    it("should connect window-added signal to workspace", () => {
      const connectSpy = vi.spyOn(workspace0, "connect");

      workspaceManager.bindWorkspaceSignals(workspace0);

      expect(connectSpy).toHaveBeenCalledWith("window-added", expect.any(Function));
    });

    it("should store signal ID in _workspaceSignals map", () => {
      workspaceManager.bindWorkspaceSignals(workspace0);

      expect(workspaceManager._workspaceSignals.has(0)).toBe(true);
      const signals = workspaceManager._workspaceSignals.get(0);
      expect(signals).toBeInstanceOf(Array);
      expect(signals.length).toBeGreaterThan(0);
    });

    it("should not double-bind to same workspace", () => {
      const connectSpy = vi.spyOn(workspace0, "connect");

      workspaceManager.bindWorkspaceSignals(workspace0);
      workspaceManager.bindWorkspaceSignals(workspace0);

      // Should only be called once
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it("should track signals only in internal Map, not on workspace object", () => {
      workspaceManager.bindWorkspaceSignals(workspace0);

      expect(workspace0.workspaceSignals).toBeUndefined();
      expect(workspaceManager._workspaceSignals.has(0)).toBe(true);
    });

    it("should not bind if workspace is already tracked in Map", () => {
      workspaceManager.bindWorkspaceSignals(workspace0);
      const connectSpy = vi.spyOn(workspace0, "connect");

      workspaceManager.bindWorkspaceSignals(workspace0);

      expect(connectSpy).not.toHaveBeenCalled();
    });
  });

  describe("unbindWorkspaceSignals()", () => {
    beforeEach(() => {
      workspaceManager.bindWorkspaceSignals(workspace0);
    });

    it("should remove signals from map", () => {
      workspaceManager.unbindWorkspaceSignals(0);

      expect(workspaceManager._workspaceSignals.has(0)).toBe(false);
    });

    it("should disconnect signals from workspace", () => {
      const disconnectSpy = vi.spyOn(workspace0, "disconnect");

      workspaceManager.unbindWorkspaceSignals(0);

      expect(disconnectSpy).toHaveBeenCalled();
    });
  });

  describe("destroy()", () => {
    beforeEach(() => {
      workspaceManager.bindWorkspaceSignals(workspace0);
      workspaceManager.bindWorkspaceSignals(workspace1);
    });

    it("should unbind all workspace signals", () => {
      workspaceManager.destroy();

      expect(workspaceManager._workspaceSignals.size).toBe(0);
    });

    it("should disconnect from all workspaces", () => {
      const disconnect0 = vi.spyOn(workspace0, "disconnect");
      const disconnect1 = vi.spyOn(workspace1, "disconnect");

      workspaceManager.destroy();

      expect(disconnect0).toHaveBeenCalled();
      expect(disconnect1).toHaveBeenCalled();
    });
  });

  describe("integration scenarios", () => {
    it("should handle workspace lifecycle: add -> bind -> unbind -> remove", () => {
      // Add workspace
      workspaceManager.addWorkspace(0);
      expect(mockTree._nodes.has("ws0")).toBe(true);
      expect(workspaceManager._workspaceSignals.has(0)).toBe(true);

      // Remove workspace
      workspaceManager.removeWorkspace(0);
      expect(workspaceManager._workspaceSignals.has(0)).toBe(false);
    });

    it("should handle multiple workspace additions and removals", () => {
      workspaceManager.addWorkspace(0);
      workspaceManager.addWorkspace(1);
      workspaceManager.addWorkspace(2);

      expect(workspaceManager._workspaceSignals.size).toBe(3);

      workspaceManager.removeWorkspace(1);
      expect(workspaceManager._workspaceSignals.size).toBe(2);
      expect(workspaceManager._workspaceSignals.has(1)).toBe(false);

      workspaceManager.destroy();
      expect(workspaceManager._workspaceSignals.size).toBe(0);
    });
  });

  describe("renumberWorkspacesAfterRemoval()", () => {
    /**
     * Helper to create a mock tree that supports getNodeByType for renumbering tests.
     * Nodes store their children and support getNodeByType filtering.
     */
    function createRenumberMockTree() {
      const allNodes = [];

      function makeNode(type, value) {
        const node = {
          _type: type,
          _value: value,
          get nodeType() {
            return this._type;
          },
          get nodeValue() {
            return this._value;
          },
          set nodeValue(v) {
            this._value = v;
          },
          childNodes: [],
          getNodeByType(t) {
            return this.childNodes.filter((c) => c.nodeType === t);
          },
        };
        allNodes.push(node);
        return node;
      }

      return {
        allNodes,
        makeNode,
        getNodeByType(type) {
          return allNodes.filter((n) => n.nodeType === type);
        },
      };
    }

    it("should renumber higher-indexed workspace and monitor nodes after middle removal", () => {
      const rt = createRenumberMockTree();
      // Create ws0, ws1, ws2 with monitor children
      const ws0 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws0");
      const ws1 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws1");
      const ws2 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws2");

      const mo0ws0 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws0");
      const mo0ws1 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws1");
      const mo0ws2 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws2");

      ws0.childNodes.push(mo0ws0);
      ws1.childNodes.push(mo0ws1);
      ws2.childNodes.push(mo0ws2);

      // Set up workspace signals
      workspaceManager._workspaceSignals.set(0, [100]);
      workspaceManager._workspaceSignals.set(1, [101]);
      workspaceManager._workspaceSignals.set(2, [102]);

      // Use our enhanced mock tree
      workspaceManager._tree = rt;

      // Remove ws1 (index 1) - ws2 should become ws1
      workspaceManager.renumberWorkspacesAfterRemoval(1);

      expect(ws0.nodeValue).toBe("ws0"); // unchanged
      expect(ws2.nodeValue).toBe("ws1"); // decremented
      expect(mo0ws0.nodeValue).toBe("mo0ws0"); // unchanged
      expect(mo0ws2.nodeValue).toBe("mo0ws1"); // decremented
    });

    it("should be a no-op when removing the last workspace", () => {
      const rt = createRenumberMockTree();
      const ws0 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws0");
      const ws1 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws1");
      const mo0ws0 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws0");
      const mo0ws1 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws1");
      ws0.childNodes.push(mo0ws0);
      ws1.childNodes.push(mo0ws1);

      workspaceManager._tree = rt;

      // Remove ws2 (index 2) when only ws0 and ws1 exist - no renumbering needed
      workspaceManager.renumberWorkspacesAfterRemoval(2);

      expect(ws0.nodeValue).toBe("ws0");
      expect(ws1.nodeValue).toBe("ws1");
      expect(mo0ws0.nodeValue).toBe("mo0ws0");
      expect(mo0ws1.nodeValue).toBe("mo0ws1");
    });

    it("should renumber all remaining nodes when removing the first workspace", () => {
      const rt = createRenumberMockTree();
      const ws0 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws0");
      const ws1 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws1");
      const ws2 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws2");
      const mo0ws0 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws0");
      const mo0ws1 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws1");
      const mo0ws2 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws2");
      ws0.childNodes.push(mo0ws0);
      ws1.childNodes.push(mo0ws1);
      ws2.childNodes.push(mo0ws2);

      workspaceManager._tree = rt;

      // Remove ws0 (index 0) - ws1->ws0, ws2->ws1
      workspaceManager.renumberWorkspacesAfterRemoval(0);

      expect(ws1.nodeValue).toBe("ws0");
      expect(ws2.nodeValue).toBe("ws1");
      expect(mo0ws1.nodeValue).toBe("mo0ws0");
      expect(mo0ws2.nodeValue).toBe("mo0ws1");
    });

    it("should update workspace signal map keys correctly", () => {
      const rt = createRenumberMockTree();
      const ws0 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws0");
      const ws1 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws1");
      const ws2 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws2");
      ws0.childNodes = [];
      ws1.childNodes = [];
      ws2.childNodes = [];

      workspaceManager._workspaceSignals.set(0, [100]);
      workspaceManager._workspaceSignals.set(2, [102]);
      // ws1 already removed from signals map (by removeWorkspace)

      workspaceManager._tree = rt;

      workspaceManager.renumberWorkspacesAfterRemoval(1);

      // Key 0 should remain, key 2 should become key 1
      expect(workspaceManager._workspaceSignals.has(0)).toBe(true);
      expect(workspaceManager._workspaceSignals.get(0)).toEqual([100]);
      expect(workspaceManager._workspaceSignals.has(1)).toBe(true);
      expect(workspaceManager._workspaceSignals.get(1)).toEqual([102]);
      expect(workspaceManager._workspaceSignals.has(2)).toBe(false);
    });

    it("should handle multiple monitors per workspace", () => {
      const rt = createRenumberMockTree();
      const ws0 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws0");
      const ws1 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws1");
      const mo0ws0 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws0");
      const mo1ws0 = rt.makeNode(NODE_TYPES.MONITOR, "mo1ws0");
      const mo0ws1 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws1");
      const mo1ws1 = rt.makeNode(NODE_TYPES.MONITOR, "mo1ws1");
      ws0.childNodes.push(mo0ws0, mo1ws0);
      ws1.childNodes.push(mo0ws1, mo1ws1);

      workspaceManager._tree = rt;

      // Remove ws0 (index 0)
      workspaceManager.renumberWorkspacesAfterRemoval(0);

      expect(ws1.nodeValue).toBe("ws0");
      expect(mo0ws1.nodeValue).toBe("mo0ws0");
      expect(mo1ws1.nodeValue).toBe("mo1ws0");
    });
  });

  describe("renumberWorkspacesAfterAddition()", () => {
    function createRenumberMockTree() {
      const allNodes = [];

      function makeNode(type, value) {
        const node = {
          _type: type,
          _value: value,
          get nodeType() {
            return this._type;
          },
          get nodeValue() {
            return this._value;
          },
          set nodeValue(v) {
            this._value = v;
          },
          childNodes: [],
          getNodeByType(t) {
            return this.childNodes.filter((c) => c.nodeType === t);
          },
        };
        allNodes.push(node);
        return node;
      }

      return {
        allNodes,
        makeNode,
        getNodeByType(type) {
          return allNodes.filter((n) => n.nodeType === type);
        },
      };
    }

    it("should shift existing nodes up when adding at non-end index", () => {
      const rt = createRenumberMockTree();
      const ws0 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws0");
      const ws1 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws1");
      const mo0ws0 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws0");
      const mo0ws1 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws1");
      ws0.childNodes.push(mo0ws0);
      ws1.childNodes.push(mo0ws1);

      workspaceManager._workspaceSignals.set(0, [100]);
      workspaceManager._workspaceSignals.set(1, [101]);

      workspaceManager._tree = rt;

      // Insert at index 1 - ws1 should become ws2
      workspaceManager.renumberWorkspacesAfterAddition(1);

      expect(ws0.nodeValue).toBe("ws0"); // unchanged
      expect(ws1.nodeValue).toBe("ws2"); // incremented
      expect(mo0ws0.nodeValue).toBe("mo0ws0"); // unchanged
      expect(mo0ws1.nodeValue).toBe("mo0ws2"); // incremented
    });

    it("should shift all nodes when adding at index 0", () => {
      const rt = createRenumberMockTree();
      const ws0 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws0");
      const ws1 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws1");
      const mo0ws0 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws0");
      const mo0ws1 = rt.makeNode(NODE_TYPES.MONITOR, "mo0ws1");
      ws0.childNodes.push(mo0ws0);
      ws1.childNodes.push(mo0ws1);

      workspaceManager._tree = rt;

      workspaceManager.renumberWorkspacesAfterAddition(0);

      expect(ws0.nodeValue).toBe("ws1");
      expect(ws1.nodeValue).toBe("ws2");
      expect(mo0ws0.nodeValue).toBe("mo0ws1");
      expect(mo0ws1.nodeValue).toBe("mo0ws2");
    });

    it("should update workspace signal map keys correctly", () => {
      const rt = createRenumberMockTree();
      const ws0 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws0");
      const ws1 = rt.makeNode(NODE_TYPES.WORKSPACE, "ws1");
      ws0.childNodes = [];
      ws1.childNodes = [];

      workspaceManager._workspaceSignals.set(0, [100]);
      workspaceManager._workspaceSignals.set(1, [101]);

      workspaceManager._tree = rt;

      // Insert at index 1 - key 1 should become key 2
      workspaceManager.renumberWorkspacesAfterAddition(1);

      expect(workspaceManager._workspaceSignals.has(0)).toBe(true);
      expect(workspaceManager._workspaceSignals.get(0)).toEqual([100]);
      expect(workspaceManager._workspaceSignals.has(2)).toBe(true);
      expect(workspaceManager._workspaceSignals.get(2)).toEqual([101]);
      expect(workspaceManager._workspaceSignals.has(1)).toBe(false);
    });
  });
});
