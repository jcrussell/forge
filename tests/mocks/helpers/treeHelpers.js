/**
 * Tree navigation and creation helpers
 *
 * Helper functions for common tree operations in tests, reducing the
 * repetitive 2-3 line patterns for workspace/monitor access and
 * window node creation.
 */

import { vi } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { Bin } from "../gnome/St.js";
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
 * Create a tiled window node from a fixture context
 *
 * Convenience helper that combines getWorkspaceAndMonitor + createWindowNode
 * for the common pattern of adding a tiled window to a test fixture.
 *
 * @param {Object} ctx - Fixture context (from createWindowManagerFixture or createTreeFixture)
 * @param {Object} [windowOverrides={}] - Overrides for createMockWindow
 * @param {number} [wsIndex=0] - Workspace index
 * @param {number} [monIndex=0] - Monitor index within workspace
 * @returns {Object} Object with nodeWindow and metaWindow
 *
 * @example
 * const { nodeWindow, metaWindow } = createTiledWindow(ctx, { wm_class: 'TestApp' });
 */
export function createTiledWindow(ctx, windowOverrides = {}, wsIndex = 0, monIndex = 0) {
  const { monitor } = getWorkspaceAndMonitor(ctx, wsIndex, monIndex);
  return createWindowNode(ctx.tree, monitor, {
    windowOverrides,
    mode: "TILE",
  });
}

/**
 * Create a container node with optional layout and rect
 *
 * @param {Object} parent - Parent node to append to
 * @param {Object} layout - Layout type (from LAYOUT_TYPES)
 * @param {Object} [rect=null] - Optional rectangle for the container
 * @returns {Object} The created container node
 *
 * @example
 * const container = createContainerNode(monitor, LAYOUT_TYPES.HSPLIT);
 * const container = createContainerNode(monitor, LAYOUT_TYPES.VSPLIT, { x: 0, y: 0, width: 960, height: 1080 });
 */
export function createContainerNode(parent, layout, rect = null) {
  const container = new Node(NODE_TYPES.CON, new Bin());
  container.layout = layout;
  if (rect) container.rect = rect;
  parent.appendChild(container);
  return container;
}

/**
 * Set the global pointer position for tests
 *
 * Replaces the common inline pattern:
 *   global.get_pointer = vi.fn(() => [x, y]);
 *
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 *
 * @example
 * setPointer(960, 540); // Center of 1920x1080 screen
 * setPointer(100, 540); // Left edge
 */
export function setPointer(x, y) {
  global.get_pointer = vi.fn(() => [x, y]);
}

export default {
  getWorkspaceAndMonitor,
  getMonitors,
  createWindowNode,
  createTiledWindow,
  createHorizontalLayout,
  createVerticalLayout,
  createStackedLayout,
  createTabbedLayout,
  createContainerNode,
  setPointer,
};
