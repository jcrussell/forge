/**
 * Test fixtures for Forge extension tests
 *
 * Complete fixture factories for setting up WindowManager, Tree, and related
 * objects with all necessary mocks. These reduce boilerplate from ~65 lines
 * to ~4 lines per test file.
 */

import { vi } from "vitest";
import { installGnomeGlobals } from "./globalSetup.js";
import { WindowManager } from "../../../lib/extension/window.js";
import { Tree, LAYOUT_TYPES } from "../../../lib/extension/tree.js";

/**
 * Default settings values used across tests
 */
export const DEFAULT_SETTINGS = {
  // Core tiling
  "tiling-mode-enabled": true,
  "focus-on-hover-enabled": false,
  "auto-split-enabled": false,

  // Layouts
  "stacked-tiling-mode-enabled": true,
  "tabbed-tiling-mode-enabled": true,
  "default-window-layout": "split",

  // Borders
  "focus-border-toggle": false,
  "focus-border-hidden-on-single": false,
  "split-border-toggle": false,

  // Gaps
  "window-gap-size": 0,
  "window-gap-size-increment": 1,
  "window-gap-hidden-on-single": false,

  // Behavior
  "window-maximize-on-single": false,
  "auto-unmaximize-for-tiling": false,
  "workspace-skip-tile": "",
  "monitor-skip-tile": "",
  "showtab-decoration-enabled": true,

  // Indicators
  "quick-settings-enabled": false,
  "tray-icon-enabled": false,

  // Resize
  "resize-amount": 10,
  "launch-app-command": "",
};

/**
 * Create a mock settings object
 *
 * @param {Object} overrides - Setting values to override defaults
 * @returns {Object} Mock settings object with get/set methods
 *
 * @example
 * const settings = createMockSettings({ 'tiling-mode-enabled': false });
 * settings.get_boolean('tiling-mode-enabled'); // false
 */
export function createMockSettings(overrides = {}) {
  const values = { ...DEFAULT_SETTINGS, ...overrides };

  return {
    get_boolean: vi.fn((key) => {
      const value = values[key];
      return typeof value === "boolean" ? value : false;
    }),
    get_uint: vi.fn((key) => {
      const value = values[key];
      return typeof value === "number" ? value : 0;
    }),
    get_string: vi.fn((key) => {
      const value = values[key];
      return typeof value === "string" ? value : "";
    }),
    set_boolean: vi.fn((key, value) => {
      values[key] = value;
    }),
    set_uint: vi.fn((key, value) => {
      values[key] = value;
    }),
    set_string: vi.fn((key, value) => {
      values[key] = value;
    }),
    // Access to internal values for testing
    _values: values,
  };
}

/**
 * Create a mock config manager
 *
 * @param {Object} options - Configuration options
 * @param {Array} [options.overrides=[]] - Window property overrides
 * @returns {Object} Mock config manager
 */
export function createMockConfigManager(options = {}) {
  const { overrides = [] } = options;

  return {
    windowProps: {
      overrides,
    },
  };
}

/**
 * Create a mock theme manager
 *
 * @returns {Object} Mock theme manager
 */
export function createMockTheme() {
  return {
    loadStylesheet: vi.fn(),
  };
}

/**
 * Create a mock extension object
 *
 * @param {Object} options - Configuration options
 * @param {Object} [options.settings] - Settings overrides (passed to createMockSettings)
 * @param {Object} [options.configMgr] - Config manager options (passed to createMockConfigManager)
 * @param {string} [options.version='1.0.0'] - Extension version
 * @returns {Object} Mock extension object
 *
 * @example
 * const ext = createMockExtension({
 *   settings: { 'tiling-mode-enabled': false }
 * });
 */
export function createMockExtension(options = {}) {
  const { settings = {}, configMgr = {}, version = "1.0.0" } = options;

  return {
    metadata: { version },
    settings: createMockSettings(settings),
    configMgr: createMockConfigManager(configMgr),
    keybindings: null,
    theme: createMockTheme(),
  };
}

/**
 * Create a complete WindowManager test fixture
 *
 * This is the main fixture for WindowManager tests. It sets up all GNOME globals,
 * creates mock extension/settings, and instantiates a WindowManager.
 *
 * @param {Object} options - Configuration options
 * @param {Object} [options.globals] - Options for installGnomeGlobals
 * @param {Object} [options.extension] - Options for createMockExtension
 * @param {Object} [options.settings] - Settings overrides (shortcut for extension.settings)
 * @returns {Object} Fixture context with windowManager, tree, mocks, and cleanup
 *
 * @example
 * // Basic usage
 * let ctx;
 * beforeEach(() => { ctx = createWindowManagerFixture(); });
 * afterEach(() => { ctx.cleanup(); });
 *
 * it('should do something', () => {
 *   const { windowManager, tree, workspaces } = ctx;
 *   // ... test code
 * });
 *
 * @example
 * // With custom options
 * const ctx = createWindowManagerFixture({
 *   globals: { display: { monitorCount: 2 } },
 *   settings: { 'auto-split-enabled': true }
 * });
 */
export function createWindowManagerFixture(options = {}) {
  const { globals = {}, extension = {}, settings = {} } = options;

  // Merge settings into extension options
  const extOptions = {
    ...extension,
    settings: { ...extension.settings, ...settings },
  };

  // Install GNOME globals
  const globalCtx = installGnomeGlobals(globals);

  // Create extension mock
  const mockExtension = createMockExtension(extOptions);

  // Create WindowManager
  const windowManager = new WindowManager(mockExtension);

  // Return context
  return {
    // Primary objects
    windowManager,
    tree: windowManager.tree,

    // Extension mocks
    extension: mockExtension,
    settings: mockExtension.settings,
    configMgr: mockExtension.configMgr,

    // Global mocks from globalSetup
    display: globalCtx.display,
    workspaceManager: globalCtx.workspaceManager,
    workspaces: globalCtx.workspaces,
    windowGroup: globalCtx.windowGroup,
    overview: globalCtx.overview,

    // Cleanup function
    cleanup: () => {
      globalCtx.cleanup();
    },
  };
}

/**
 * Create a Tree-only test fixture (without full WindowManager)
 *
 * Use this for Tree tests that don't need full WindowManager functionality.
 *
 * @param {Object} options - Configuration options
 * @param {Object} [options.globals] - Options for installGnomeGlobals
 * @param {Object} [options.settings] - Settings values
 * @param {string} [options.defaultLayout='HSPLIT'] - Default layout for new containers
 * @param {boolean} [options.fullExtWm=false] - Include more WindowManager methods for operation tests
 * @returns {Object} Fixture context with tree, mocks, and cleanup
 *
 * @example
 * let ctx;
 * beforeEach(() => { ctx = createTreeFixture(); });
 * afterEach(() => { ctx.cleanup(); });
 */
export function createTreeFixture(options = {}) {
  const { globals = {}, settings = {}, defaultLayout = "HSPLIT", fullExtWm = false } = options;

  // Install GNOME globals
  const globalCtx = installGnomeGlobals(globals);

  // Create mock settings
  const mockSettings = createMockSettings(settings);

  // Create minimal WindowManager mock needed by Tree
  const mockWindowManager = {
    ext: {
      settings: mockSettings,
    },
    determineSplitLayout: vi.fn(() => LAYOUT_TYPES[defaultLayout] || LAYOUT_TYPES.HSPLIT),
    bindWorkspaceSignals: vi.fn(),
  };

  // Add extended methods for operation tests (move, split, etc.)
  if (fullExtWm) {
    Object.assign(mockWindowManager, {
      move: vi.fn(),
      movePointerWith: vi.fn(),
      getPointer: vi.fn(() => [100, 100]),
      focusMetaWindow: null,
      currentMonWsNode: null,
      rectForMonitor: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      sameParentMonitor: vi.fn(() => true),
      floatingWindow: vi.fn(() => false),
      calculateGaps: vi.fn(() => 0),
    });
  }

  // Create Tree
  const tree = new Tree(mockWindowManager);

  return {
    tree,
    settings: mockSettings,
    extWm: mockWindowManager,

    // Global mocks
    display: globalCtx.display,
    workspaceManager: globalCtx.workspaceManager,
    workspaces: globalCtx.workspaces,
    windowGroup: globalCtx.windowGroup,

    cleanup: () => {
      globalCtx.cleanup();
    },
  };
}

/**
 * Create a fixture for WorkspaceManager tests
 *
 * @param {Object} options - Configuration options
 * @param {Object} [options.globals] - Options for installGnomeGlobals
 * @returns {Object} Fixture context
 */
export function createWorkspaceManagerFixture(options = {}) {
  const { globals = {} } = options;

  // Install GNOME globals
  const globalCtx = installGnomeGlobals(globals);

  // Create minimal Tree mock
  const mockTree = {
    addWorkspace: vi.fn(() => true),
    removeWorkspace: vi.fn(() => true),
    nodeWorkpaces: [],
    findNode: vi.fn(),
  };

  // Create minimal ExtWm mock
  const mockExtWm = {
    tree: mockTree,
    ext: {
      settings: createMockSettings(),
    },
    renderTree: vi.fn(),
  };

  return {
    tree: mockTree,
    extWm: mockExtWm,
    display: globalCtx.display,
    workspaceManager: globalCtx.workspaceManager,
    workspaces: globalCtx.workspaces,

    cleanup: () => {
      globalCtx.cleanup();
    },
  };
}

export default {
  DEFAULT_SETTINGS,
  createMockSettings,
  createMockConfigManager,
  createMockTheme,
  createMockExtension,
  createWindowManagerFixture,
  createTreeFixture,
  createWorkspaceManagerFixture,
};
