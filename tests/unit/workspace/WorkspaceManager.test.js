import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkspaceManager } from '../../../lib/extension/workspace.js';
import { Tree, NODE_TYPES, LAYOUT_TYPES } from '../../../lib/extension/tree.js';
import { Workspace } from '../../mocks/gnome/Meta.js';

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
describe('WorkspaceManager', () => {
  let workspaceManager;
  let mockTree;
  let mockExtWm;
  let workspace0;
  let workspace1;

  beforeEach(() => {
    // Create mock workspaces
    workspace0 = new Workspace({ index: 0 });
    workspace1 = new Workspace({ index: 1 });

    // Mock global display and workspace manager
    global.display = {
      get_workspace_manager: vi.fn(),
      get_n_monitors: vi.fn(() => 1),
      get_monitor_geometry: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 }))
    };

    global.workspace_manager = {
      get_n_workspaces: vi.fn(() => 2),
      get_workspace_by_index: vi.fn((i) => {
        if (i === 0) return workspace0;
        if (i === 1) return workspace1;
        return new Workspace({ index: i });
      }),
      get_active_workspace_index: vi.fn(() => 0)
    };

    global.display.get_workspace_manager.mockReturnValue(global.workspace_manager);

    global.window_group = {
      _children: [],
      contains: vi.fn((child) => global.window_group._children.includes(child)),
      add_child: vi.fn((child) => global.window_group._children.push(child)),
      remove_child: vi.fn((child) => {
        const idx = global.window_group._children.indexOf(child);
        if (idx !== -1) global.window_group._children.splice(idx, 1);
      })
    };

    // Create a mock tree with minimal implementation
    mockTree = {
      nodeValue: 'root',
      _nodes: new Map(),
      createNode: vi.fn((parentValue, type, nodeValue) => {
        const node = {
          nodeValue,
          nodeType: type,
          layout: null,
          actorBin: null,
          childNodes: []
        };
        mockTree._nodes.set(nodeValue, node);
        return node;
      }),
      findNode: vi.fn((nodeValue) => mockTree._nodes.get(nodeValue) || null),
      removeChild: vi.fn((node) => {
        mockTree._nodes.delete(node.nodeValue);
      }),
      addMonitor: vi.fn()
    };

    // Create a mock WindowManager
    mockExtWm = {
      determineSplitLayout: vi.fn(() => LAYOUT_TYPES.HSPLIT),
      updateMetaWorkspaceMonitor: vi.fn(),
      _wsWindowAddSrcId: 0
    };

    // Create WorkspaceManager instance
    workspaceManager = new WorkspaceManager(mockTree, mockExtWm);
  });

  describe('constructor', () => {
    it('should store tree and extWm references', () => {
      expect(workspaceManager._tree).toBe(mockTree);
      expect(workspaceManager._extWm).toBe(mockExtWm);
    });

    it('should initialize empty workspace signals map', () => {
      expect(workspaceManager._workspaceSignals).toBeInstanceOf(Map);
      expect(workspaceManager._workspaceSignals.size).toBe(0);
    });
  });

  describe('addWorkspace()', () => {
    it('should create a workspace node in the tree', () => {
      const result = workspaceManager.addWorkspace(0);

      expect(result).toBe(true);
      expect(mockTree.createNode).toHaveBeenCalledWith('root', NODE_TYPES.WORKSPACE, 'ws0');
    });

    it('should set workspace node layout to HSPLIT', () => {
      workspaceManager.addWorkspace(0);

      const wsNode = mockTree._nodes.get('ws0');
      expect(wsNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it('should create an actorBin for the workspace', () => {
      workspaceManager.addWorkspace(0);

      const wsNode = mockTree._nodes.get('ws0');
      expect(wsNode.actorBin).toBeDefined();
      expect(wsNode.actorBin.style_class).toBe('workspace-actor-bg');
    });

    it('should add actorBin to global.window_group', () => {
      workspaceManager.addWorkspace(0);

      expect(global.window_group.add_child).toHaveBeenCalled();
    });

    it('should call tree.addMonitor for the workspace', () => {
      workspaceManager.addWorkspace(0);

      expect(mockTree.addMonitor).toHaveBeenCalledWith(0);
    });

    it('should return false if workspace already exists', () => {
      // First add
      workspaceManager.addWorkspace(0);

      // Second add should return false
      const result = workspaceManager.addWorkspace(0);
      expect(result).toBe(false);
    });

    it('should bind workspace signals', () => {
      workspaceManager.addWorkspace(0);

      expect(workspaceManager._workspaceSignals.has(0)).toBe(true);
    });

    it('should handle multiple workspaces', () => {
      workspaceManager.addWorkspace(0);
      workspaceManager.addWorkspace(1);

      expect(mockTree._nodes.has('ws0')).toBe(true);
      expect(mockTree._nodes.has('ws1')).toBe(true);
      expect(workspaceManager._workspaceSignals.size).toBe(2);
    });
  });

  describe('removeWorkspace()', () => {
    beforeEach(() => {
      // Add a workspace first
      workspaceManager.addWorkspace(0);
    });

    it('should remove the workspace node from tree', () => {
      const result = workspaceManager.removeWorkspace(0);

      expect(result).toBe(true);
      expect(mockTree.removeChild).toHaveBeenCalled();
    });

    it('should remove actorBin from window_group', () => {
      // Need to set up contains to return true
      const wsNode = mockTree._nodes.get('ws0');
      global.window_group._children.push(wsNode.actorBin);
      global.window_group.contains.mockReturnValue(true);

      workspaceManager.removeWorkspace(0);

      expect(global.window_group.remove_child).toHaveBeenCalled();
    });

    it('should unbind workspace signals', () => {
      workspaceManager.removeWorkspace(0);

      expect(workspaceManager._workspaceSignals.has(0)).toBe(false);
    });

    it('should return false if workspace does not exist', () => {
      const result = workspaceManager.removeWorkspace(99);

      expect(result).toBe(false);
    });
  });

  describe('bindWorkspaceSignals()', () => {
    it('should connect window-added signal to workspace', () => {
      const connectSpy = vi.spyOn(workspace0, 'connect');

      workspaceManager.bindWorkspaceSignals(workspace0);

      expect(connectSpy).toHaveBeenCalledWith('window-added', expect.any(Function));
    });

    it('should store signal ID in _workspaceSignals map', () => {
      workspaceManager.bindWorkspaceSignals(workspace0);

      expect(workspaceManager._workspaceSignals.has(0)).toBe(true);
      const signals = workspaceManager._workspaceSignals.get(0);
      expect(signals).toBeInstanceOf(Array);
      expect(signals.length).toBeGreaterThan(0);
    });

    it('should not bind if workspace is null', () => {
      workspaceManager.bindWorkspaceSignals(null);

      expect(workspaceManager._workspaceSignals.size).toBe(0);
    });

    it('should not bind if workspace lacks connect method', () => {
      const badWorkspace = { index: () => 5 };

      workspaceManager.bindWorkspaceSignals(badWorkspace);

      expect(workspaceManager._workspaceSignals.size).toBe(0);
    });

    it('should not double-bind to same workspace', () => {
      const connectSpy = vi.spyOn(workspace0, 'connect');

      workspaceManager.bindWorkspaceSignals(workspace0);
      workspaceManager.bindWorkspaceSignals(workspace0);

      // Should only be called once
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('should set workspaceSignals property on metaWorkspace for backwards compat', () => {
      workspaceManager.bindWorkspaceSignals(workspace0);

      expect(workspace0.workspaceSignals).toBeDefined();
      expect(workspace0.workspaceSignals).toBeInstanceOf(Array);
    });

    it('should not bind if workspace already has workspaceSignals property', () => {
      workspace0.workspaceSignals = [123];
      const connectSpy = vi.spyOn(workspace0, 'connect');

      workspaceManager.bindWorkspaceSignals(workspace0);

      expect(connectSpy).not.toHaveBeenCalled();
    });
  });

  describe('unbindWorkspaceSignals()', () => {
    beforeEach(() => {
      workspaceManager.bindWorkspaceSignals(workspace0);
    });

    it('should remove signals from map', () => {
      workspaceManager.unbindWorkspaceSignals(0);

      expect(workspaceManager._workspaceSignals.has(0)).toBe(false);
    });

    it('should disconnect signals from workspace', () => {
      const disconnectSpy = vi.spyOn(workspace0, 'disconnect');

      workspaceManager.unbindWorkspaceSignals(0);

      expect(disconnectSpy).toHaveBeenCalled();
    });

    it('should handle missing workspace index gracefully', () => {
      expect(() => {
        workspaceManager.unbindWorkspaceSignals(99);
      }).not.toThrow();
    });

    it('should handle workspace that no longer exists', () => {
      // Make workspace_manager return null for index 0
      global.workspace_manager.get_workspace_by_index.mockReturnValue(null);

      expect(() => {
        workspaceManager.unbindWorkspaceSignals(0);
      }).not.toThrow();

      expect(workspaceManager._workspaceSignals.has(0)).toBe(false);
    });
  });

  describe('destroy()', () => {
    beforeEach(() => {
      workspaceManager.bindWorkspaceSignals(workspace0);
      workspaceManager.bindWorkspaceSignals(workspace1);
    });

    it('should unbind all workspace signals', () => {
      workspaceManager.destroy();

      expect(workspaceManager._workspaceSignals.size).toBe(0);
    });

    it('should disconnect from all workspaces', () => {
      const disconnect0 = vi.spyOn(workspace0, 'disconnect');
      const disconnect1 = vi.spyOn(workspace1, 'disconnect');

      workspaceManager.destroy();

      expect(disconnect0).toHaveBeenCalled();
      expect(disconnect1).toHaveBeenCalled();
    });

    it('should handle empty signals map', () => {
      workspaceManager._workspaceSignals.clear();

      expect(() => {
        workspaceManager.destroy();
      }).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should handle workspace lifecycle: add -> bind -> unbind -> remove', () => {
      // Add workspace
      workspaceManager.addWorkspace(0);
      expect(mockTree._nodes.has('ws0')).toBe(true);
      expect(workspaceManager._workspaceSignals.has(0)).toBe(true);

      // Remove workspace
      workspaceManager.removeWorkspace(0);
      expect(workspaceManager._workspaceSignals.has(0)).toBe(false);
    });

    it('should handle multiple workspace additions and removals', () => {
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
});
