/**
 * Tree navigation and creation helpers
 *
 * Helper functions for common tree operations in tests, reducing the
 * repetitive 2-3 line patterns for workspace/monitor access and
 * window node creation.
 */

import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { createMockWindow } from "./mockWindow.js";

/**
 * Get workspace and monitor nodes from a tree or WindowManager
 *
 * Replaces the common 2-line pattern:
 *   const workspace = tree.nodeWorkpaces[0];
 *   const monitor = workspace.getNodeByType(NODE_TYPES.MONITOR)[0];
 *
 * @param {Object} source - WindowManager, Tree, or fixture context
 * @param {number} [wsIndex=0] - Workspace index
 * @param {number} [monIndex=0] - Monitor index within workspace
 * @returns {Object} Object with workspace and monitor nodes
 *
 * @example
 * const { workspace, monitor } = getWorkspaceAndMonitor(ctx.windowManager);
 * const { workspace, monitor } = getWorkspaceAndMonitor(ctx.tree);
 * const { workspace, monitor } = getWorkspaceAndMonitor(ctx); // fixture context
 */
export function getWorkspaceAndMonitor(source, wsIndex = 0, monIndex = 0) {
  // Extract tree from various source types
  const tree = source.tree || source;

  const workspace = tree.nodeWorkpaces[wsIndex];
  if (!workspace) {
    throw new Error(`Workspace at index ${wsIndex} not found`);
  }

  const monitors = workspace.getNodeByType(NODE_TYPES.MONITOR);
  const monitor = monitors[monIndex];
  if (!monitor) {
    throw new Error(`Monitor at index ${monIndex} not found in workspace ${wsIndex}`);
  }

  return { workspace, monitor };
}

/**
 * Get all monitors from a workspace
 *
 * @param {Object} source - WindowManager, Tree, or fixture context
 * @param {number} [wsIndex=0] - Workspace index
 * @returns {Array} Array of monitor nodes
 */
export function getMonitors(source, wsIndex = 0) {
  const tree = source.tree || source;
  const workspace = tree.nodeWorkpaces[wsIndex];
  if (!workspace) {
    throw new Error(`Workspace at index ${wsIndex} not found`);
  }
  return workspace.getNodeByType(NODE_TYPES.MONITOR);
}

/**
 * Create a window node in the tree
 *
 * Combines createMockWindow + tree.createNode into one call, and optionally
 * sets the mode and layout.
 *
 * @param {Object} tree - Tree instance
 * @param {Object} parent - Parent node (typically monitor)
 * @param {Object} [options] - Options
 * @param {Object} [options.windowOverrides] - Overrides for createMockWindow
 * @param {string} [options.mode='TILE'] - Window mode (TILE, FLOAT, etc.)
 * @param {string} [options.layout] - Parent layout to set before creating
 * @returns {Object} Object with nodeWindow and metaWindow
 *
 * @example
 * const { nodeWindow, metaWindow } = createWindowNode(ctx.tree, monitor);
 * const { nodeWindow } = createWindowNode(ctx.tree, monitor, { mode: 'FLOAT' });
 */
export function createWindowNode(tree, parent, options = {}) {
  const { windowOverrides = {}, mode = "TILE", layout = null } = options;

  // Set parent layout if specified
  if (layout && LAYOUT_TYPES[layout]) {
    parent.layout = LAYOUT_TYPES[layout];
  }

  // Create mock window
  const metaWindow = createMockWindow(windowOverrides);

  // Create node in tree
  const nodeWindow = tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, metaWindow);

  // Set mode
  if (nodeWindow && WINDOW_MODES[mode]) {
    nodeWindow.mode = WINDOW_MODES[mode];
  }

  return { nodeWindow, metaWindow };
}

/**
 * Create multiple window nodes in a horizontal layout
 *
 * @param {Object} tree - Tree instance
 * @param {Object} parent - Parent node (typically monitor)
 * @param {number} count - Number of windows to create
 * @param {Object} [options] - Options passed to createWindowNode
 * @returns {Array} Array of { nodeWindow, metaWindow } objects
 *
 * @example
 * const windows = createHorizontalLayout(ctx.tree, monitor, 3);
 * const [first, second, third] = windows;
 */
export function createHorizontalLayout(tree, parent, count, options = {}) {
  parent.layout = LAYOUT_TYPES.HSPLIT;

  return Array.from({ length: count }, (_, i) =>
    createWindowNode(tree, parent, {
      ...options,
      windowOverrides: {
        id: `win-h-${i}`,
        ...options.windowOverrides,
      },
    })
  );
}

/**
 * Create multiple window nodes in a vertical layout
 *
 * @param {Object} tree - Tree instance
 * @param {Object} parent - Parent node (typically monitor)
 * @param {number} count - Number of windows to create
 * @param {Object} [options] - Options passed to createWindowNode
 * @returns {Array} Array of { nodeWindow, metaWindow } objects
 *
 * @example
 * const windows = createVerticalLayout(ctx.tree, monitor, 2);
 */
export function createVerticalLayout(tree, parent, count, options = {}) {
  parent.layout = LAYOUT_TYPES.VSPLIT;

  return Array.from({ length: count }, (_, i) =>
    createWindowNode(tree, parent, {
      ...options,
      windowOverrides: {
        id: `win-v-${i}`,
        ...options.windowOverrides,
      },
    })
  );
}

/**
 * Create a stacked layout with multiple windows
 *
 * @param {Object} tree - Tree instance
 * @param {Object} parent - Parent node (typically monitor)
 * @param {number} count - Number of windows to create
 * @param {Object} [options] - Options passed to createWindowNode
 * @returns {Array} Array of { nodeWindow, metaWindow } objects
 */
export function createStackedLayout(tree, parent, count, options = {}) {
  parent.layout = LAYOUT_TYPES.STACKED;

  return Array.from({ length: count }, (_, i) =>
    createWindowNode(tree, parent, {
      ...options,
      windowOverrides: {
        id: `win-s-${i}`,
        ...options.windowOverrides,
      },
    })
  );
}

/**
 * Create a tabbed layout with multiple windows
 *
 * @param {Object} tree - Tree instance
 * @param {Object} parent - Parent node (typically monitor)
 * @param {number} count - Number of windows to create
 * @param {Object} [options] - Options passed to createWindowNode
 * @returns {Array} Array of { nodeWindow, metaWindow } objects
 */
export function createTabbedLayout(tree, parent, count, options = {}) {
  parent.layout = LAYOUT_TYPES.TABBED;

  return Array.from({ length: count }, (_, i) =>
    createWindowNode(tree, parent, {
      ...options,
      windowOverrides: {
        id: `win-t-${i}`,
        ...options.windowOverrides,
      },
    })
  );
}

/**
 * Find a window node by its metaWindow reference
 *
 * @param {Object} tree - Tree instance
 * @param {Object} metaWindow - Meta.Window to find
 * @returns {Object|null} Window node or null
 */
export function findWindowNode(tree, metaWindow) {
  const windows = tree.getNodeByType(NODE_TYPES.WINDOW);
  return windows.find((n) => n.nodeValue === metaWindow) || null;
}

/**
 * Get all window nodes from a tree
 *
 * @param {Object} source - WindowManager, Tree, or fixture context
 * @returns {Array} Array of window nodes
 */
export function getAllWindowNodes(source) {
  const tree = source.tree || source;
  return tree.getNodeByType(NODE_TYPES.WINDOW);
}

/**
 * Get all container nodes from a tree
 *
 * @param {Object} source - WindowManager, Tree, or fixture context
 * @returns {Array} Array of container nodes
 */
export function getAllContainerNodes(source) {
  const tree = source.tree || source;
  return tree.getNodeByType(NODE_TYPES.CON);
}

/**
 * Set up a window as the focused window in the display mock
 *
 * @param {Object} metaWindow - Meta.Window to focus
 */
export function setFocusedWindow(metaWindow) {
  if (global.display && global.display.get_focus_window) {
    global.display.get_focus_window.mockReturnValue(metaWindow);
  }
}

/**
 * Create a complete test scenario with multiple windows
 *
 * @param {Object} tree - Tree instance
 * @param {Object} monitor - Monitor node
 * @param {Object} scenario - Scenario configuration
 * @param {string} scenario.layout - Layout type ('HSPLIT', 'VSPLIT', 'STACKED', 'TABBED')
 * @param {number} scenario.windowCount - Number of windows
 * @param {number} [scenario.focusIndex] - Index of window to focus
 * @returns {Object} Object with windows array and focused window info
 *
 * @example
 * const { windows, focused } = createScenario(ctx.tree, monitor, {
 *   layout: 'HSPLIT',
 *   windowCount: 3,
 *   focusIndex: 1
 * });
 */
export function createScenario(tree, monitor, scenario) {
  const { layout, windowCount, focusIndex = null } = scenario;

  // Create layout
  let windows;
  switch (layout) {
    case "VSPLIT":
      windows = createVerticalLayout(tree, monitor, windowCount);
      break;
    case "STACKED":
      windows = createStackedLayout(tree, monitor, windowCount);
      break;
    case "TABBED":
      windows = createTabbedLayout(tree, monitor, windowCount);
      break;
    case "HSPLIT":
    default:
      windows = createHorizontalLayout(tree, monitor, windowCount);
      break;
  }

  // Set focus if specified
  let focused = null;
  if (focusIndex !== null && windows[focusIndex]) {
    focused = windows[focusIndex];
    setFocusedWindow(focused.metaWindow);
  }

  return { windows, focused };
}

export default {
  getWorkspaceAndMonitor,
  getMonitors,
  createWindowNode,
  createHorizontalLayout,
  createVerticalLayout,
  createStackedLayout,
  createTabbedLayout,
  findWindowNode,
  getAllWindowNodes,
  getAllContainerNodes,
  setFocusedWindow,
  createScenario,
};
