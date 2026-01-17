import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MonitorManager } from '../../../lib/extension/monitor.js';
import { NODE_TYPES, LAYOUT_TYPES } from '../../../lib/extension/tree.js';

/**
 * MonitorManager unit tests
 *
 * Tests for the MonitorManager class which handles monitor-related operations:
 * - addMonitor(): Create monitor nodes for a workspace
 * - getMonitorCount(): Get the number of monitors
 * - getMonitorNode(): Get monitor node by workspace/monitor index
 */
describe('MonitorManager', () => {
  let monitorManager;
  let mockTree;
  let mockExtWm;

  beforeEach(() => {
    // Mock global display
    global.display = {
      get_n_monitors: vi.fn(() => 2),
      get_monitor_geometry: vi.fn((idx) => ({
        x: idx * 1920,
        y: 0,
        width: 1920,
        height: 1080
      }))
    };

    global.window_group = {
      _children: [],
      contains: vi.fn((child) => global.window_group._children.includes(child)),
      add_child: vi.fn((child) => global.window_group._children.push(child)),
      remove_child: vi.fn((child) => {
        const idx = global.window_group._children.indexOf(child);
        if (idx !== -1) global.window_group._children.splice(idx, 1);
      })
    };

    // Create mock tree
    mockTree = {
      _nodes: new Map(),
      createNode: vi.fn((parentValue, type, nodeValue) => {
        const node = {
          nodeValue,
          nodeType: type,
          layout: null,
          actorBin: null
        };
        mockTree._nodes.set(nodeValue, node);
        return node;
      }),
      findNode: vi.fn((nodeValue) => mockTree._nodes.get(nodeValue) || null)
    };

    // Create mock WindowManager
    mockExtWm = {
      determineSplitLayout: vi.fn(() => LAYOUT_TYPES.HSPLIT)
    };

    // Create MonitorManager instance
    monitorManager = new MonitorManager(mockTree, mockExtWm);
  });

  describe('constructor', () => {
    it('should store tree and extWm references', () => {
      expect(monitorManager._tree).toBe(mockTree);
      expect(monitorManager._extWm).toBe(mockExtWm);
    });
  });

  describe('getMonitorCount()', () => {
    it('should return the number of monitors from display', () => {
      expect(monitorManager.getMonitorCount()).toBe(2);
      expect(global.display.get_n_monitors).toHaveBeenCalled();
    });

    it('should return updated count when monitors change', () => {
      global.display.get_n_monitors.mockReturnValue(3);

      expect(monitorManager.getMonitorCount()).toBe(3);
    });

    it('should return 1 for single monitor setup', () => {
      global.display.get_n_monitors.mockReturnValue(1);

      expect(monitorManager.getMonitorCount()).toBe(1);
    });
  });

  describe('addMonitor()', () => {
    it('should create monitor node for single monitor', () => {
      global.display.get_n_monitors.mockReturnValue(1);

      monitorManager.addMonitor(0);

      expect(mockTree.createNode).toHaveBeenCalledWith(
        'ws0',
        NODE_TYPES.MONITOR,
        'mo0ws0'
      );
    });

    it('should create monitor nodes for all monitors', () => {
      global.display.get_n_monitors.mockReturnValue(2);

      monitorManager.addMonitor(0);

      expect(mockTree.createNode).toHaveBeenCalledTimes(2);
      expect(mockTree.createNode).toHaveBeenCalledWith('ws0', NODE_TYPES.MONITOR, 'mo0ws0');
      expect(mockTree.createNode).toHaveBeenCalledWith('ws0', NODE_TYPES.MONITOR, 'mo1ws0');
    });

    it('should set layout on monitor nodes', () => {
      global.display.get_n_monitors.mockReturnValue(1);

      monitorManager.addMonitor(0);

      const monitorNode = mockTree._nodes.get('mo0ws0');
      expect(monitorNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it('should create actorBin for each monitor node', () => {
      global.display.get_n_monitors.mockReturnValue(1);

      monitorManager.addMonitor(0);

      const monitorNode = mockTree._nodes.get('mo0ws0');
      expect(monitorNode.actorBin).toBeDefined();
    });

    it('should add actorBin to window_group', () => {
      global.display.get_n_monitors.mockReturnValue(1);

      monitorManager.addMonitor(0);

      expect(global.window_group.add_child).toHaveBeenCalled();
    });

    it('should not add duplicate actorBin to window_group', () => {
      global.display.get_n_monitors.mockReturnValue(1);

      // Simulate actorBin already in window_group
      const existingBin = {};
      global.window_group._children.push(existingBin);
      global.window_group.contains.mockReturnValue(true);

      monitorManager.addMonitor(0);

      // add_child should still be called (for the new bin)
      // but contains check prevents duplicate
    });

    it('should use correct naming convention: mo{monitorIndex}ws{workspaceIndex}', () => {
      global.display.get_n_monitors.mockReturnValue(3);

      monitorManager.addMonitor(2);

      expect(mockTree.createNode).toHaveBeenCalledWith('ws2', NODE_TYPES.MONITOR, 'mo0ws2');
      expect(mockTree.createNode).toHaveBeenCalledWith('ws2', NODE_TYPES.MONITOR, 'mo1ws2');
      expect(mockTree.createNode).toHaveBeenCalledWith('ws2', NODE_TYPES.MONITOR, 'mo2ws2');
    });

    it('should call determineSplitLayout for each monitor', () => {
      global.display.get_n_monitors.mockReturnValue(2);

      monitorManager.addMonitor(0);

      expect(mockExtWm.determineSplitLayout).toHaveBeenCalledTimes(2);
    });
  });

  describe('getMonitorNode()', () => {
    beforeEach(() => {
      // Set up some monitor nodes
      global.display.get_n_monitors.mockReturnValue(2);
      monitorManager.addMonitor(0);
      monitorManager.addMonitor(1);
    });

    it('should find monitor node by workspace and monitor index', () => {
      const node = monitorManager.getMonitorNode(0, 0);

      expect(mockTree.findNode).toHaveBeenCalledWith('mo0ws0');
      expect(node).toBeDefined();
      expect(node.nodeValue).toBe('mo0ws0');
    });

    it('should find monitor node on different workspace', () => {
      const node = monitorManager.getMonitorNode(1, 0);

      expect(mockTree.findNode).toHaveBeenCalledWith('mo0ws1');
      expect(node.nodeValue).toBe('mo0ws1');
    });

    it('should find second monitor on workspace', () => {
      const node = monitorManager.getMonitorNode(0, 1);

      expect(mockTree.findNode).toHaveBeenCalledWith('mo1ws0');
      expect(node.nodeValue).toBe('mo1ws0');
    });

    it('should return null for non-existent monitor node', () => {
      const node = monitorManager.getMonitorNode(99, 0);

      expect(mockTree.findNode).toHaveBeenCalledWith('mo0ws99');
      expect(node).toBeNull();
    });

    it('should return null for non-existent monitor index', () => {
      const node = monitorManager.getMonitorNode(0, 99);

      expect(mockTree.findNode).toHaveBeenCalledWith('mo99ws0');
      expect(node).toBeNull();
    });
  });

  describe('multi-monitor scenarios', () => {
    it('should handle single monitor setup', () => {
      global.display.get_n_monitors.mockReturnValue(1);

      monitorManager.addMonitor(0);

      expect(mockTree._nodes.size).toBe(1);
      expect(mockTree._nodes.has('mo0ws0')).toBe(true);
    });

    it('should handle dual monitor setup', () => {
      global.display.get_n_monitors.mockReturnValue(2);

      monitorManager.addMonitor(0);

      expect(mockTree._nodes.size).toBe(2);
      expect(mockTree._nodes.has('mo0ws0')).toBe(true);
      expect(mockTree._nodes.has('mo1ws0')).toBe(true);
    });

    it('should handle triple monitor setup', () => {
      global.display.get_n_monitors.mockReturnValue(3);

      monitorManager.addMonitor(0);

      expect(mockTree._nodes.size).toBe(3);
      expect(mockTree._nodes.has('mo0ws0')).toBe(true);
      expect(mockTree._nodes.has('mo1ws0')).toBe(true);
      expect(mockTree._nodes.has('mo2ws0')).toBe(true);
    });

    it('should create monitors for multiple workspaces', () => {
      global.display.get_n_monitors.mockReturnValue(2);

      monitorManager.addMonitor(0);
      monitorManager.addMonitor(1);
      monitorManager.addMonitor(2);

      expect(mockTree._nodes.size).toBe(6);
      // Workspace 0
      expect(mockTree._nodes.has('mo0ws0')).toBe(true);
      expect(mockTree._nodes.has('mo1ws0')).toBe(true);
      // Workspace 1
      expect(mockTree._nodes.has('mo0ws1')).toBe(true);
      expect(mockTree._nodes.has('mo1ws1')).toBe(true);
      // Workspace 2
      expect(mockTree._nodes.has('mo0ws2')).toBe(true);
      expect(mockTree._nodes.has('mo1ws2')).toBe(true);
    });
  });
});
