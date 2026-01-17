import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandHandler } from '../../../lib/extension/command.js';
import { NODE_TYPES, LAYOUT_TYPES, ORIENTATION_TYPES } from '../../../lib/extension/tree.js';
import { WINDOW_MODES } from '../../../lib/extension/window.js';
import { createMockWindow } from '../../mocks/helpers/mockWindow.js';
import { GrabOp } from '../../mocks/gnome/Meta.js';

/**
 * CommandHandler unit tests
 *
 * Tests for the CommandHandler class which processes keyboard and action commands.
 * Focus on commands not well covered by WindowManager-commands.test.js:
 * - WindowResetSizes
 * - LayoutStackedToggle / LayoutTabbedToggle
 * - CancelOperation
 * - ConfigReload
 * - MovePointerToFocus
 * - WindowSwapLastActive
 * - SnapLayoutMove
 * - ShowTabDecorationToggle
 * - WindowResize commands
 */
describe('CommandHandler', () => {
  let commandHandler;
  let mockWm;
  let mockTree;
  let mockNodeWindow;
  let mockMetaWindow;
  let mockSettings;
  let mockExt;

  beforeEach(() => {
    // Create mock meta window
    mockMetaWindow = createMockWindow({
      wm_class: 'TestApp',
      title: 'Test Window'
    });

    // Create mock node window
    mockNodeWindow = {
      nodeValue: mockMetaWindow,
      nodeType: NODE_TYPES.WINDOW,
      mode: WINDOW_MODES.TILE,
      rect: { x: 0, y: 0, width: 800, height: 600 },
      parentNode: {
        layout: LAYOUT_TYPES.HSPLIT,
        childNodes: [],
        lastChild: null,
        lastTabFocus: null,
        isMonitor: vi.fn(() => false),
        appendChild: vi.fn(),
        parentNode: {
          layout: LAYOUT_TYPES.HSPLIT
        }
      },
      isFloat: vi.fn(() => false)
    };
    mockNodeWindow.parentNode.lastChild = mockNodeWindow;

    // Create mock settings
    mockSettings = {
      get_boolean: vi.fn((key) => {
        const defaults = {
          'focus-border-toggle': true,
          'tiling-mode-enabled': true,
          'stacked-tiling-mode-enabled': true,
          'tabbed-tiling-mode-enabled': true,
          'showtab-decoration-enabled': true
        };
        return defaults[key] ?? false;
      }),
      get_uint: vi.fn((key) => {
        if (key === 'window-gap-size-increment') return 4;
        return 0;
      }),
      get_string: vi.fn(() => ''),
      set_boolean: vi.fn(),
      set_uint: vi.fn(),
      set_string: vi.fn()
    };

    // Create mock extension
    mockExt = {
      settings: mockSettings,
      openPreferences: vi.fn()
    };

    // Create mock tree
    mockTree = {
      getTiledChildren: vi.fn(() => [mockNodeWindow]),
      resetSiblingPercent: vi.fn(),
      move: vi.fn(() => true),
      focus: vi.fn(() => mockNodeWindow),
      swap: vi.fn(),
      swapPairs: vi.fn(),
      split: vi.fn(),
      processGap: vi.fn((node) => node.rect),
      findNode: vi.fn(() => mockNodeWindow),
      attachNode: null
    };

    // Create mock WindowManager
    mockWm = {
      ext: mockExt,
      tree: mockTree,
      focusMetaWindow: mockMetaWindow,
      findNodeWindow: vi.fn(() => mockNodeWindow),
      toggleFloatingMode: vi.fn(),
      move: vi.fn(),
      renderTree: vi.fn(),
      unfreezeRender: vi.fn(),
      queueEvent: vi.fn(),
      updateStackedFocus: vi.fn(),
      updateTabbedFocus: vi.fn(),
      movePointerWith: vi.fn(),
      determineSplitLayout: vi.fn(() => LAYOUT_TYPES.HSPLIT),
      applyDefaultLayoutToContainer: vi.fn(),
      floatAllWindows: vi.fn(),
      unfloatAllWindows: vi.fn(),
      floatWorkspace: vi.fn(),
      unfloatWorkspace: vi.fn(),
      cancelGrab: false,
      prefsTitle: 'Forge Preferences',
      reloadWindowOverrides: vi.fn(),
      toggleWorkspaceMonocle: vi.fn(),
      addFloatOverride: vi.fn(),
      resize: vi.fn(),
      moveCenter: vi.fn(),
      eventQueue: []
    };

    // Set up global mocks
    global.workspace_manager = {
      get_active_workspace_index: vi.fn(() => 0),
      get_active_workspace: vi.fn(() => ({ index: () => 0 }))
    };

    global.display = {
      get_current_time: vi.fn(() => 12345),
      get_tab_next: vi.fn(() => mockMetaWindow),
      get_workspace_manager: vi.fn(() => global.workspace_manager)
    };

    // Create CommandHandler
    commandHandler = new CommandHandler(mockWm);
  });

  describe('constructor', () => {
    it('should store window manager reference', () => {
      expect(commandHandler._extWm).toBe(mockWm);
    });
  });

  describe('WindowResetSizes command', () => {
    it('should reset sibling percentages for parent node', () => {
      commandHandler.execute({ name: 'WindowResetSizes' });

      expect(mockTree.resetSiblingPercent).toHaveBeenCalledWith(mockNodeWindow.parentNode);
    });

    it('should reset sibling percentages for grandparent node', () => {
      commandHandler.execute({ name: 'WindowResetSizes' });

      expect(mockTree.resetSiblingPercent).toHaveBeenCalledWith(mockNodeWindow.parentNode.parentNode);
    });

    it('should render tree after reset', () => {
      commandHandler.execute({ name: 'WindowResetSizes' });

      expect(mockWm.renderTree).toHaveBeenCalledWith('window-reset-sizes');
    });

    it('should do nothing if no focus window node', () => {
      mockWm.findNodeWindow.mockReturnValue(null);

      commandHandler.execute({ name: 'WindowResetSizes' });

      expect(mockTree.resetSiblingPercent).not.toHaveBeenCalled();
    });

    it('should handle missing grandparent gracefully', () => {
      mockNodeWindow.parentNode.parentNode = null;

      commandHandler.execute({ name: 'WindowResetSizes' });

      // Should still reset parent
      expect(mockTree.resetSiblingPercent).toHaveBeenCalledWith(mockNodeWindow.parentNode);
    });
  });

  describe('LayoutStackedToggle command', () => {
    beforeEach(() => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === 'stacked-tiling-mode-enabled') return true;
        return false;
      });
    });

    it('should toggle from HSPLIT to STACKED', () => {
      mockNodeWindow.parentNode.layout = LAYOUT_TYPES.HSPLIT;

      commandHandler.execute({ name: 'LayoutStackedToggle' });

      expect(mockNodeWindow.parentNode.layout).toBe(LAYOUT_TYPES.STACKED);
    });

    it('should toggle from STACKED to split layout', () => {
      mockNodeWindow.parentNode.layout = LAYOUT_TYPES.STACKED;

      commandHandler.execute({ name: 'LayoutStackedToggle' });

      expect(mockWm.determineSplitLayout).toHaveBeenCalled();
    });

    it('should split first if parent is monitor', () => {
      mockNodeWindow.parentNode.isMonitor.mockReturnValue(true);

      commandHandler.execute({ name: 'LayoutStackedToggle' });

      expect(mockTree.split).toHaveBeenCalledWith(mockNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
    });

    it('should clear lastTabFocus when switching from tabbed', () => {
      mockNodeWindow.parentNode.layout = LAYOUT_TYPES.TABBED;
      mockNodeWindow.parentNode.lastTabFocus = mockMetaWindow;

      commandHandler.execute({ name: 'LayoutStackedToggle' });

      expect(mockNodeWindow.parentNode.lastTabFocus).toBeNull();
    });

    it('should call unfreezeRender', () => {
      commandHandler.execute({ name: 'LayoutStackedToggle' });

      expect(mockWm.unfreezeRender).toHaveBeenCalled();
    });

    it('should do nothing if stacked mode disabled', () => {
      mockSettings.get_boolean.mockReturnValue(false);

      commandHandler.execute({ name: 'LayoutStackedToggle' });

      expect(mockNodeWindow.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it('should do nothing if no focus window', () => {
      mockWm.findNodeWindow.mockReturnValue(null);

      expect(() => {
        commandHandler.execute({ name: 'LayoutStackedToggle' });
      }).not.toThrow();
    });
  });

  describe('LayoutTabbedToggle command', () => {
    beforeEach(() => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === 'tabbed-tiling-mode-enabled') return true;
        return false;
      });
    });

    it('should toggle from HSPLIT to TABBED', () => {
      mockNodeWindow.parentNode.layout = LAYOUT_TYPES.HSPLIT;

      commandHandler.execute({ name: 'LayoutTabbedToggle' });

      expect(mockNodeWindow.parentNode.layout).toBe(LAYOUT_TYPES.TABBED);
    });

    it('should set lastTabFocus when enabling tabbed', () => {
      mockNodeWindow.parentNode.layout = LAYOUT_TYPES.HSPLIT;

      commandHandler.execute({ name: 'LayoutTabbedToggle' });

      expect(mockNodeWindow.parentNode.lastTabFocus).toBe(mockMetaWindow);
    });

    it('should toggle from TABBED to split layout and clear lastTabFocus', () => {
      mockNodeWindow.parentNode.layout = LAYOUT_TYPES.TABBED;
      mockNodeWindow.parentNode.lastTabFocus = mockMetaWindow;

      commandHandler.execute({ name: 'LayoutTabbedToggle' });

      expect(mockWm.determineSplitLayout).toHaveBeenCalled();
      expect(mockNodeWindow.parentNode.lastTabFocus).toBeNull();
    });

    it('should do nothing if tabbed mode disabled', () => {
      mockSettings.get_boolean.mockReturnValue(false);

      commandHandler.execute({ name: 'LayoutTabbedToggle' });

      expect(mockNodeWindow.parentNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });
  });

  describe('CancelOperation command', () => {
    it('should set cancelGrab flag when in grab tile mode', () => {
      mockNodeWindow.mode = WINDOW_MODES.GRAB_TILE;

      commandHandler.execute({ name: 'CancelOperation' });

      expect(mockWm.cancelGrab).toBe(true);
    });

    it('should not set cancelGrab if not in grab mode', () => {
      mockNodeWindow.mode = WINDOW_MODES.TILE;

      commandHandler.execute({ name: 'CancelOperation' });

      expect(mockWm.cancelGrab).toBe(false);
    });
  });

  describe('ConfigReload command', () => {
    it('should call reloadWindowOverrides', () => {
      commandHandler.execute({ name: 'ConfigReload' });

      expect(mockWm.reloadWindowOverrides).toHaveBeenCalled();
    });
  });

  describe('MovePointerToFocus command', () => {
    it('should call movePointerWith with force option', () => {
      commandHandler.execute({ name: 'MovePointerToFocus' });

      expect(mockWm.movePointerWith).toHaveBeenCalledWith(mockNodeWindow, { force: true });
    });

    it('should not call movePointerWith if no focus window', () => {
      mockWm.findNodeWindow.mockReturnValue(null);

      commandHandler.execute({ name: 'MovePointerToFocus' });

      expect(mockWm.movePointerWith).not.toHaveBeenCalled();
    });
  });

  describe('WorkspaceMonocleToggle command', () => {
    it('should call toggleWorkspaceMonocle', () => {
      commandHandler.execute({ name: 'WorkspaceMonocleToggle' });

      expect(mockWm.toggleWorkspaceMonocle).toHaveBeenCalled();
    });
  });

  describe('WindowSwapLastActive command', () => {
    it('should swap with last active window', () => {
      const lastActiveWindow = createMockWindow({ title: 'Last Active' });
      const lastActiveNode = { nodeValue: lastActiveWindow };

      global.display.get_tab_next.mockReturnValue(lastActiveWindow);
      mockTree.findNode.mockReturnValue(lastActiveNode);

      commandHandler.execute({ name: 'WindowSwapLastActive' });

      expect(mockTree.swapPairs).toHaveBeenCalledWith(lastActiveNode, mockNodeWindow);
    });

    it('should move pointer after swap', () => {
      commandHandler.execute({ name: 'WindowSwapLastActive' });

      expect(mockWm.movePointerWith).toHaveBeenCalledWith(mockNodeWindow);
    });

    it('should render tree after swap', () => {
      commandHandler.execute({ name: 'WindowSwapLastActive' });

      expect(mockWm.renderTree).toHaveBeenCalledWith('swap-last-active');
    });

    it('should not swap if no focus window', () => {
      mockWm.findNodeWindow.mockReturnValue(null);

      commandHandler.execute({ name: 'WindowSwapLastActive' });

      expect(mockTree.swapPairs).not.toHaveBeenCalled();
    });
  });

  describe('ShowTabDecorationToggle command', () => {
    beforeEach(() => {
      mockSettings.get_boolean.mockImplementation((key) => {
        if (key === 'tabbed-tiling-mode-enabled') return true;
        if (key === 'showtab-decoration-enabled') return true;
        return false;
      });
    });

    it('should toggle showtab-decoration-enabled setting', () => {
      commandHandler.execute({ name: 'ShowTabDecorationToggle' });

      expect(mockSettings.set_boolean).toHaveBeenCalledWith('showtab-decoration-enabled', false);
    });

    it('should call unfreezeRender', () => {
      commandHandler.execute({ name: 'ShowTabDecorationToggle' });

      expect(mockWm.unfreezeRender).toHaveBeenCalled();
    });

    it('should do nothing if tabbed mode disabled', () => {
      mockSettings.get_boolean.mockReturnValue(false);

      commandHandler.execute({ name: 'ShowTabDecorationToggle' });

      expect(mockSettings.set_boolean).not.toHaveBeenCalled();
    });

    it('should do nothing if no focus window', () => {
      mockWm.findNodeWindow.mockReturnValue(null);

      commandHandler.execute({ name: 'ShowTabDecorationToggle' });

      expect(mockSettings.set_boolean).not.toHaveBeenCalled();
    });
  });

  describe('Window resize commands', () => {
    it('should resize right with amount', () => {
      commandHandler.execute({ name: 'WindowResizeRight', amount: 50 });

      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_E, 50);
    });

    it('should resize left with amount', () => {
      commandHandler.execute({ name: 'WindowResizeLeft', amount: 30 });

      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_W, 30);
    });

    it('should resize top with amount', () => {
      commandHandler.execute({ name: 'WindowResizeTop', amount: 40 });

      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_N, 40);
    });

    it('should resize bottom with amount', () => {
      commandHandler.execute({ name: 'WindowResizeBottom', amount: 60 });

      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_S, 60);
    });
  });

  describe('WindowExpand command', () => {
    it('should resize all four edges', () => {
      commandHandler.execute({ name: 'WindowExpand', amount: 20 });

      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_N, 20);
      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_S, 20);
      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_W, 20);
      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_E, 20);
    });
  });

  describe('WindowShrink command', () => {
    it('should resize all four edges with negative amount', () => {
      commandHandler.execute({ name: 'WindowShrink', amount: 20 });

      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_N, -20);
      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_S, -20);
      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_W, -20);
      expect(mockWm.resize).toHaveBeenCalledWith(GrabOp.KEYBOARD_RESIZING_E, -20);
    });
  });

  describe('SnapLayoutMove command', () => {
    beforeEach(() => {
      mockMetaWindow.get_work_area_current_monitor = vi.fn(() => ({
        x: 0,
        y: 0,
        width: 1920,
        height: 1080
      }));
      mockMetaWindow.get_frame_rect = vi.fn(() => ({
        x: 100,
        y: 100,
        width: 800,
        height: 600
      }));
    });

    it('should snap to left with layout amount', () => {
      commandHandler.execute({
        name: 'SnapLayoutMove',
        direction: 'left',
        amount: 0.5
      });

      expect(mockNodeWindow.rect.width).toBe(960); // 0.5 * 1920
      expect(mockNodeWindow.rect.x).toBe(0);
    });

    it('should snap to right with layout amount', () => {
      commandHandler.execute({
        name: 'SnapLayoutMove',
        direction: 'right',
        amount: 0.5
      });

      expect(mockNodeWindow.rect.width).toBe(960);
      expect(mockNodeWindow.rect.x).toBe(960); // 1920 - 960
    });

    it('should add float override if window not floating', () => {
      mockNodeWindow.isFloat.mockReturnValue(false);

      commandHandler.execute({
        name: 'SnapLayoutMove',
        direction: 'left',
        amount: 0.5
      });

      expect(mockWm.addFloatOverride).toHaveBeenCalledWith(mockMetaWindow, false);
    });

    it('should call move with calculated rect', () => {
      commandHandler.execute({
        name: 'SnapLayoutMove',
        direction: 'left',
        amount: 0.5
      });

      expect(mockWm.move).toHaveBeenCalled();
    });

    it('should queue render event', () => {
      commandHandler.execute({
        name: 'SnapLayoutMove',
        direction: 'left',
        amount: 0.5
      });

      expect(mockWm.queueEvent).toHaveBeenCalledWith({
        name: 'snap-layout-move',
        callback: expect.any(Function)
      });
    });

    it('should not snap if no focus window', () => {
      mockWm.findNodeWindow.mockReturnValue(null);

      commandHandler.execute({
        name: 'SnapLayoutMove',
        direction: 'left',
        amount: 0.5
      });

      expect(mockWm.move).not.toHaveBeenCalled();
    });
  });

  describe('Unknown command', () => {
    it('should handle unknown command gracefully', () => {
      expect(() => {
        commandHandler.execute({ name: 'UnknownCommand' });
      }).not.toThrow();
    });
  });
});
