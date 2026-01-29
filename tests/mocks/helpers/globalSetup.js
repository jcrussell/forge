/**
 * Global setup helpers for GNOME Shell mocks
 *
 * Factory functions for creating mock GNOME global objects (display, workspace_manager, etc.)
 * that are used across test files. Use installGnomeGlobals() for one-liner setup.
 */

import { vi } from "vitest";
import { Workspace, Rectangle } from "../gnome/Meta.js";

/**
 * Default monitor geometry
 */
export const DEFAULT_MONITOR_GEOMETRY = { x: 0, y: 0, width: 1920, height: 1080 };

/**
 * Create a mock display object
 * @param {Object} options - Configuration options
 * @param {number} [options.monitorCount=1] - Number of monitors
 * @param {Object[]} [options.monitorGeometries] - Array of monitor geometries
 * @param {Function} [options.getFocusWindow] - Custom get_focus_window implementation
 * @returns {Object} Mock display object
 */
export function createMockDisplay(options = {}) {
  const { monitorCount = 1, monitorGeometries = null, getFocusWindow = () => null } = options;

  // Generate geometries for each monitor if not provided
  const geometries =
    monitorGeometries ||
    Array.from({ length: monitorCount }, (_, i) => ({
      x: i * DEFAULT_MONITOR_GEOMETRY.width,
      y: 0,
      width: DEFAULT_MONITOR_GEOMETRY.width,
      height: DEFAULT_MONITOR_GEOMETRY.height,
    }));

  return {
    get_workspace_manager: vi.fn(),
    get_n_monitors: vi.fn(() => monitorCount),
    get_focus_window: vi.fn(getFocusWindow),
    get_current_monitor: vi.fn(() => 0),
    get_current_time: vi.fn(() => 12345),
    get_monitor_geometry: vi.fn((index) => {
      const geom = geometries[index] || geometries[0];
      return new Rectangle(geom);
    }),
    get_monitor_scale: vi.fn(() => 1),
    get_monitor_neighbor_index: vi.fn(() => -1),
    sort_windows_by_stacking: vi.fn((windows) => windows),
  };
}

/**
 * Create a mock workspace manager
 * @param {Object} options - Configuration options
 * @param {number} [options.workspaceCount=1] - Number of workspaces
 * @param {number} [options.activeWorkspaceIndex=0] - Active workspace index
 * @param {Workspace[]} [options.workspaces] - Pre-created workspace objects
 * @returns {Object} Mock workspace manager and workspaces array
 */
export function createMockWorkspaceManager(options = {}) {
  const { workspaceCount = 1, activeWorkspaceIndex = 0, workspaces = null } = options;

  // Create workspaces if not provided
  const wsArray =
    workspaces || Array.from({ length: workspaceCount }, (_, i) => new Workspace({ index: i }));

  const workspaceManager = {
    get_n_workspaces: vi.fn(() => wsArray.length),
    get_workspace_by_index: vi.fn((i) => wsArray[i] || new Workspace({ index: i })),
    get_active_workspace_index: vi.fn(() => activeWorkspaceIndex),
    get_active_workspace: vi.fn(() => wsArray[activeWorkspaceIndex]),
  };

  return { workspaceManager, workspaces: wsArray };
}

/**
 * Create a mock window_group object
 * @returns {Object} Mock window_group
 */
export function createMockWindowGroup() {
  const children = [];
  return {
    _children: children,
    contains: vi.fn((child) => children.includes(child)),
    add_child: vi.fn((child) => {
      if (!children.includes(child)) children.push(child);
    }),
    remove_child: vi.fn((child) => {
      const index = children.indexOf(child);
      if (index !== -1) children.splice(index, 1);
    }),
  };
}

/**
 * Create a mock stage object
 * @param {Object} options - Configuration options
 * @param {number} [options.width=1920] - Stage width
 * @param {number} [options.height=1080] - Stage height
 * @returns {Object} Mock stage
 */
export function createMockStage(options = {}) {
  const { width = 1920, height = 1080 } = options;
  return {
    get_width: vi.fn(() => width),
    get_height: vi.fn(() => height),
  };
}

/**
 * Create a mock overview object
 * @param {Object} options - Configuration options
 * @param {boolean} [options.visible=false] - Whether overview is visible
 * @returns {Object} Mock overview
 */
export function createMockOverview(options = {}) {
  const { visible = false } = options;
  const _signals = {};
  return {
    visible,
    _signals,
    connect: vi.fn((signal, callback) => {
      if (!_signals[signal]) _signals[signal] = [];
      const id = Math.random();
      _signals[signal].push({ id, callback });
      return id;
    }),
    disconnect: vi.fn((id) => {
      for (const signal in _signals) {
        _signals[signal] = _signals[signal].filter((s) => s.id !== id);
      }
    }),
  };
}

/**
 * Install all GNOME globals in one call
 *
 * @param {Object} options - Configuration options
 * @param {Object} [options.display] - Display options (see createMockDisplay)
 * @param {Object} [options.workspaceManager] - Workspace manager options (see createMockWorkspaceManager)
 * @param {Object} [options.windowGroup] - Window group options (or false to skip)
 * @param {Object} [options.stage] - Stage options (or false to skip)
 * @param {Object} [options.overview] - Overview options (or false to skip)
 * @returns {Object} Object containing all created mocks and a cleanup function
 *
 * @example
 * // Simple usage
 * let ctx;
 * beforeEach(() => { ctx = installGnomeGlobals(); });
 * afterEach(() => { ctx.cleanup(); });
 *
 * @example
 * // With options
 * const ctx = installGnomeGlobals({
 *   display: { monitorCount: 2 },
 *   workspaceManager: { workspaceCount: 3 }
 * });
 */
export function installGnomeGlobals(options = {}) {
  const displayOpts = options.display || {};
  const wmOpts = options.workspaceManager || {};

  // Create display
  const display = createMockDisplay(displayOpts);

  // Create workspace manager and link to display
  const { workspaceManager, workspaces } = createMockWorkspaceManager(wmOpts);
  display.get_workspace_manager.mockReturnValue(workspaceManager);

  // Install globals
  global.display = display;
  global.workspace_manager = workspaceManager;

  // Optional globals
  let windowGroup = null;
  if (options.windowGroup !== false) {
    windowGroup = createMockWindowGroup();
    global.window_group = windowGroup;
  }

  let stage = null;
  if (options.stage !== false) {
    stage = createMockStage(options.stage || {});
    global.stage = stage;
  }

  let overview = null;
  if (options.overview !== false) {
    overview = createMockOverview(options.overview || {});
    if (!global.Main) global.Main = {};
    global.Main.overview = overview;
  }

  // Common global functions
  global.get_current_time = vi.fn(() => 12345);
  global.get_pointer = vi.fn(() => [0, 0, 0]);
  global.get_window_actors = vi.fn(() => []);

  // Cleanup function
  const cleanup = () => {
    vi.clearAllTimers();
    delete global.display;
    delete global.workspace_manager;
    delete global.window_group;
    delete global.stage;
    delete global.get_current_time;
    delete global.get_pointer;
    delete global.get_window_actors;
    if (global.Main) delete global.Main.overview;
  };

  return {
    display,
    workspaceManager,
    workspaces,
    windowGroup,
    stage,
    overview,
    cleanup,
  };
}

export default {
  DEFAULT_MONITOR_GEOMETRY,
  createMockDisplay,
  createMockWorkspaceManager,
  createMockWindowGroup,
  createMockStage,
  createMockOverview,
  installGnomeGlobals,
};
