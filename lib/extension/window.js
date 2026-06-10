/*
 * This file is part of the Forge extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// Gnome imports
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import St from "gi://St";

// Gnome Shell imports
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { PACKAGE_VERSION } from "resource:///org/gnome/shell/misc/config.js";

// Shared state
import { Logger } from "../shared/logger.js";

// App imports
import { createEnum } from "./enum.js";
import * as Utils from "./utils.js";
import {
  calculateDropRegions,
  detectDropZone,
  DROP_ZONES,
  isHorizontalZone,
  isBeforeZone,
} from "./utils.js";
import {
  Tree,
  Queue,
  Node,
  POSITION,
  LAYOUT_TYPES,
  ORIENTATION_TYPES,
  NODE_TYPES,
} from "./tree.js";
import { production } from "../shared/settings.js";
import { CommandHandler } from "./command.js";
import * as Compat from "./compat.js";

/** @typedef {import('../../extension.js').default} ForgeExtension */

export const WINDOW_MODES = createEnum(["FLOAT", "TILE", "GRAB_TILE", "DEFAULT"]);

// Simplify the grab modes
export const GRAB_TYPES = createEnum(["RESIZING", "MOVING", "UNKNOWN"]);

// Bug #351 fix: Window types that shouldn't be tiled (browser popups, tooltips, etc.)
const INVALID_WINDOW_TYPES = new Set([
  Meta.WindowType.UTILITY,
  Meta.WindowType.POPUP_MENU,
  Meta.WindowType.DROPDOWN_MENU,
  Meta.WindowType.TOOLTIP,
]);

const VALID_WINDOW_TYPES = new Set([
  Meta.WindowType.NORMAL,
  Meta.WindowType.MODAL_DIALOG,
  Meta.WindowType.DIALOG,
]);

/**
 * Disconnect all signals from a target and clear the array
 * @param {Object} target - The object to disconnect signals from
 * @param {number[]} signals - Array of signal IDs
 */
function disconnectSignals(target, signals) {
  if (!target || !signals) return;
  for (const signal of signals) {
    // Bug #328: a finalized GObject wrapper throws on disconnect; one bad
    // target must not abort cleanup of the remaining signals/targets.
    try {
      target.disconnect(signal);
    } catch (e) {
      Logger.debug(`disconnect on disposed target skipped: ${e}`);
    }
  }
  signals.length = 0;
}

export class WindowManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /** @type {ForgeExtension} */
  ext;

  /** @param {ForgeExtension} ext */
  constructor(ext) {
    super();
    this.ext = ext;
    this.prefsTitle = `Forge ${_("Settings")} - ${
      !production ? "DEV" : `${PACKAGE_VERSION}-${ext.metadata.version}`
    }`;
    this.reloadWindowOverrides();
    this._kbd = this.ext.keybindings;
    this._tree = new Tree(this);
    this.eventQueue = new Queue();
    this.theme = this.ext.theme;
    this.lastFocusedWindow = null;
    this.shouldFocusOnHover = this.ext.settings.get_boolean("focus-on-hover-enabled");

    // Create command handler for processing commands
    this._commandHandler = new CommandHandler(this);

    Logger.info("forge initialized");

    if (this.shouldFocusOnHover) {
      // Start the pointer loop to observe the pointer position
      // and change the focus window accordingly
      this.pointerLoopInit();
    }
  }

  pointerLoopInit() {
    this._clearTimeoutId("_pointerFocusTimeoutId");

    this._pointerFocusTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      16,
      this._focusWindowUnderPointer.bind(this)
    );
  }

  /**
   * Load window overrides, apply an update function, then save.
   * @param {Function} updateFn - Receives (overrides, wmClass, wmId), returns updated overrides
   * @param {Meta.Window} metaWindow
   * @param {boolean} withWmId
   */
  _updateWindowOverrides(updateFn, metaWindow, withWmId) {
    let currentProps = this.ext.configMgr.windowProps;
    let wmClass = metaWindow.get_wm_class();
    let wmId = metaWindow.get_id();
    currentProps.overrides = updateFn(currentProps.overrides, wmClass, wmId, withWmId);
    this.ext.configMgr.windowProps = currentProps;
    this.windowProps = currentProps;
  }

  // Add a {wmClass, [wmId], mode} override for this window, de-duping against an
  // existing same-mode rule. Per-window (withWmId) and class-wide (!withWmId)
  // rules are kept distinct (Bug #172/#453).
  _addModeOverride(metaWindow, withWmId, mode) {
    this._updateWindowOverrides(
      (overrides, wmClass, wmId, withWmId) => {
        for (let override of overrides) {
          if (override.mode !== mode) continue;
          if (withWmId) {
            if (override.wmClass === wmClass && override.wmId === wmId) return overrides;
          } else {
            if (override.wmClass === wmClass && !override.wmId && !override.wmTitle)
              return overrides;
          }
        }
        overrides.push({
          wmClass: wmClass,
          wmId: withWmId ? wmId : undefined,
          mode: mode,
        });
        return overrides;
      },
      metaWindow,
      withWmId
    );
  }

  // Remove the {wmClass, [wmId], mode} overrides Forge writes for this window.
  // Title-bearing rules are user-authored and persistent, so they are left
  // alone; a per-window remove (withWmId) leaves class-wide rules intact (#172).
  _removeModeOverride(metaWindow, withWmId, mode) {
    this._updateWindowOverrides(
      (overrides, wmClass, wmId, withWmId) => {
        return overrides.filter(
          (override) =>
            !(
              override.mode === mode &&
              override.wmClass === wmClass &&
              !override.wmTitle &&
              (!withWmId || override.wmId === wmId)
            )
        );
      },
      metaWindow,
      withWmId
    );
  }

  addFloatOverride(metaWindow, withWmId) {
    this._addModeOverride(metaWindow, withWmId, "float");
  }

  removeFloatOverride(metaWindow, withWmId) {
    this._removeModeOverride(metaWindow, withWmId, "float");
  }

  addTileOverride(metaWindow, withWmId) {
    this._addModeOverride(metaWindow, withWmId, "tile");
  }

  removeTileOverride(metaWindow, withWmId) {
    this._removeModeOverride(metaWindow, withWmId, "tile");
  }

  toggleFloatingMode(action, metaWindow) {
    let nodeWindow = this.findNodeWindow(metaWindow);
    if (!nodeWindow || !action) return;
    if (nodeWindow.nodeType !== NODE_TYPES.WINDOW) return;

    let withWmId = action.name === "FloatToggle";

    if (this.isFloatingExempt(metaWindow)) {
      // Toggle toward TILED. Drop any float override this window owns; if it is
      // still exempt (forge-fxf #387: floated only by a broader class rule), add
      // a winning per-window tile override so just this window tiles, leaving the
      // class rule and its siblings untouched.
      this.removeFloatOverride(metaWindow, withWmId);
      if (this.isFloatingExempt(metaWindow)) {
        this.addTileOverride(metaWindow, withWmId);
      }
    } else {
      // Toggle toward FLOATING. Drop any tile override this window owns (clean
      // reversibility); if it is still tiled, add a float override.
      this.removeTileOverride(metaWindow, withWmId);
      if (!this.isFloatingExempt(metaWindow)) {
        this.addFloatOverride(metaWindow, withWmId);
      }
    }

    // Bug #319: use the float setter so _forgeSetAbove is handled. Mirror
    // processFloats so the node reflects the new decision before the trailing
    // renderTree reconciles the whole tree.
    nodeWindow.float =
      this.isFloatingExempt(metaWindow) ||
      !this.isActiveWindowWorkspaceTiled(metaWindow) ||
      !this.isActiveWindowMonitorTiled(metaWindow);
  }

  queueEvent(eventObj, interval = 220) {
    this.eventQueue.enqueue(eventObj);

    if (!this._queueSourceId) {
      this._queueSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
        const currEventObj = this.eventQueue.dequeue();
        if (currEventObj) {
          try {
            currEventObj.callback();
          } catch (e) {
            // Bug #531: an uncaught throw would remove this source with
            // _queueSourceId still set, silencing the queue forever.
            Logger.warn(`queueEvent: ${currEventObj.name} callback failed: ${e}`);
          }
        }
        const result = this.eventQueue.length !== 0;
        if (!result) {
          this._queueSourceId = 0;
        }
        return result;
      });
    }
  }

  /**
   * This is the central place to bind all the non-window signals.
   */
  _bindSignals() {
    if (this._signalsBound) return;

    const display = global.display;
    const shellWm = global.window_manager;

    this._displaySignals = [
      display.connect("window-created", this.trackWindow.bind(this)),
      display.connect("grab-op-begin", this._handleGrabOpBegin.bind(this)),
      display.connect("window-entered-monitor", (_, monitor, metaWindow) => {
        this.updateMetaWorkspaceMonitor("window-entered-monitor", monitor, metaWindow);
        this.trackCurrentMonWs();
      }),
      display.connect("grab-op-end", this._handleGrabOpEnd.bind(this)),
      display.connect("showing-desktop-changed", () => {
        this.hideWindowBorders();
        this.updateDecorationLayout();
      }),
      display.connect("in-fullscreen-changed", () => {
        // forge-zo4: renderTree's pipeline reconciles fullscreen float demotion
        // (after processFloats), so floats drop below a newly-fullscreen window.
        this.renderTree("full-screen-changed");
      }),
      display.connect("workareas-changed", this._onWorkareasChanged.bind(this)),
    ];

    this._windowManagerSignals = [
      shellWm.connect("minimize", () =>
        this._onMinimizeChange("minimize", { hideBorders: true, resetGrandparentIfEmpty: true })
      ),
      shellWm.connect("unminimize", () => this._onMinimizeChange("unminimize")),
      shellWm.connect("show-tile-preview", (_, _metaWindow, _rect, _num) => {
        // Empty
      }),
    ];

    const globalWsm = global.workspace_manager;

    this._workspaceManagerSignals = [
      globalWsm.connect("showing-desktop-changed", () => {
        this.hideWindowBorders();
        this.updateDecorationLayout();
      }),
      globalWsm.connect("workspace-added", (_, wsIndex) => {
        // If a node with this index already exists, shift existing nodes up first
        if (this.tree.findNode(`ws${wsIndex}`)) {
          this.tree.workspaceManager.renumberWorkspacesAfterAddition(wsIndex);
        }
        this.tree.addWorkspace(wsIndex);
        this.trackCurrentMonWs();
        this.workspaceAdded = true;
        this.renderTree("workspace-added");
      }),
      globalWsm.connect("workspace-removed", (_, wsIndex) => {
        this.tree.removeWorkspace(wsIndex);
        this.tree.workspaceManager.renumberWorkspacesAfterRemoval(wsIndex);
        this.trackCurrentMonWs();
        this.workspaceRemoved = true;
        this.updateDecorationLayout();
        this.renderTree("workspace-removed");
      }),
      globalWsm.connect("active-workspace-changed", () => {
        // Bug #374 fix: Set flag to prevent focus jumping during workspace transitions
        this._workspaceChanging = true;
        this.hideWindowBorders();
        this.trackCurrentMonWs();
        this.updateDecorationLayout();
        this.renderTree("active-workspace-changed");
        // Clear previous timer to avoid races on rapid workspace switches
        this._clearTimeoutId("_workspaceChangingTimeoutId");
        // Clear flag after workspace animation completes (300ms)
        this._workspaceChangingTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          this._workspaceChangingTimeoutId = 0;
          this._workspaceChanging = false;
          return false;
        });
      }),
    ];

    let numberOfWorkspaces = globalWsm.get_n_workspaces();

    for (let i = 0; i < numberOfWorkspaces; i++) {
      let workspace = globalWsm.get_workspace_by_index(i);
      this.bindWorkspaceSignals(workspace);
    }

    let settings = this.ext.settings;

    this._settingsSignals = [];
    this._settingsSignals.push(
      settings.connect("changed", (_, settingName) => {
        switch (settingName) {
          case "window-overrides-reload-trigger":
            // Reload window overrides when triggered by preferences
            // This prevents the main extension from overwriting changes made by preferences
            this.reloadWindowOverrides();
            break;
          case "focus-border-toggle":
          case "focus-border-hidden-on-single":
            this.renderTree(settingName);
            break;
          case "focus-on-hover-enabled":
            this.shouldFocusOnHover = settings.get_boolean(settingName);

            if (this.shouldFocusOnHover) {
              this.pointerLoopInit();
            }

            break;
          case "tiling-mode-enabled":
            this.renderTree(settingName);
            break;
          case "window-gap-size-increment":
          case "window-gap-size":
          case "window-gap-hidden-on-single":
          case "workspace-skip-tile":
            this.renderTree(settingName, true);
            break;
          case "stacked-tiling-mode-enabled":
            this._handleLayoutModeToggle(settingName, LAYOUT_TYPES.STACKED);
            break;
          case "tabbed-tiling-mode-enabled":
            this._handleLayoutModeToggle(settingName, LAYOUT_TYPES.TABBED);
            break;
          case "css-updated":
            this.theme.reloadStylesheet();
            break;
          case "float-always-on-top-enabled":
            if (!settings.get_boolean(settingName)) {
              this.cleanupAlwaysFloat();
            } else {
              this.restoreAlwaysFloat();
            }
            break;
          default:
            break;
        }
      })
    );

    this._overviewSignals = [
      Main.overview.connect("hiding", () => {
        this.fromOverview = true;
        const eventObj = {
          name: "focus-after-overview",
          callback: () => {
            const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
            this.updateStackedFocus(focusNodeWindow);
            this.updateTabbedFocus(focusNodeWindow);
            this.movePointerWith(focusNodeWindow);
          },
        };
        this.queueEvent(eventObj);
      }),
      Main.overview.connect("showing", () => {
        this.toOverview = true;
      }),
    ];

    this._signalsBound = true;
  }

  /**
   * Handle the display's "workareas-changed" signal. The monitor-count guard keeps
   * windows attached to the tree during transient monitor loss (KVM switch, lock).
   */
  _onWorkareasChanged(_display) {
    if (global.display.get_n_monitors() == 0) {
      Logger.debug(`workareas-changed: no monitors, ignoring signal`);
      return;
    }
    if (this.tree.getNodeByType("WINDOW").length > 0) {
      if (this.workspaceAdded || this.workspaceRemoved) {
        this.trackCurrentWindows();
        this.workspaceRemoved = false;
        this.workspaceAdded = false;
      } else {
        this.renderTree("workareas-changed");
      }
    }
  }

  cleanupAlwaysFloat() {
    // remove the setting for each node window, but keep dialogs/transients on top
    this.allNodeWindows.forEach((w) => {
      if (w.mode === WINDOW_MODES.FLOAT) {
        const metaWindow = w.nodeValue;
        const isDialog =
          metaWindow.get_window_type() === Meta.WindowType.DIALOG ||
          metaWindow.get_window_type() === Meta.WindowType.MODAL_DIALOG ||
          metaWindow.get_transient_for() !== null;
        if (!isDialog) {
          metaWindow.is_above() && metaWindow.unmake_above();
        }
      }
    });
  }

  restoreAlwaysFloat() {
    this.allNodeWindows.forEach((w) => {
      if (w.mode === WINDOW_MODES.FLOAT) {
        !w.nodeValue.is_above() && w.nodeValue.make_above();
      }
    });
  }

  /**
   * forge-zo4 (#460): when a window goes fullscreen, Forge-pinned always-on-top
   * floats on the SAME monitor must drop below it instead of rendering over the
   * fullscreen surface. Recomputed from scratch on every (arg-less, infrequent)
   * in-fullscreen-changed, so no persistent per-monitor count is kept — the
   * per-node `_aboveDemotedForFullscreen` flag carries the "restore me once my
   * monitor has no fullscreen window" intent. Mirrors cleanupAlwaysFloat's
   * dialog/transient exclusion and only ever touches floats Forge itself pinned.
   */
  _reconcileFullscreenFloatDemotion() {
    if (!this.tree) return;
    // Only meaningful when Forge manages float stacking.
    if (!this.ext.settings.get_boolean("float-always-on-top-enabled")) {
      this._restoreAllDemotedFloats();
      return;
    }

    const nodes = this.allNodeWindows;
    // Count qualifying fullscreen windows per monitor (dialogs/transients are
    // forced above by design and never block floats).
    const fullscreenCounts = new Map();
    nodes.forEach((w) => {
      const metaWindow = w.nodeValue;
      if (!metaWindow || !metaWindow.is_fullscreen()) return;
      if (this._isDialogLike(metaWindow)) return;
      const monIdx = this._monitorIndexOfNode(w);
      fullscreenCounts.set(monIdx, (fullscreenCounts.get(monIdx) || 0) + 1);
    });

    this._withSuppressedAboveHandler(() => {
      nodes.forEach((w) => {
        if (w.mode !== WINDOW_MODES.FLOAT) return;
        const metaWindow = w.nodeValue;
        if (!metaWindow) return;
        const blocked = (fullscreenCounts.get(this._monitorIndexOfNode(w)) || 0) > 0;

        // Demote: a Forge-pinned float on a monitor that now has a fullscreen
        // window. Never the fullscreen window itself, a dialog, or a user pin.
        if (
          blocked &&
          w._forgeSetAbove &&
          metaWindow.is_above() &&
          !metaWindow.is_fullscreen() &&
          !this._isDialogLike(metaWindow)
        ) {
          metaWindow.unmake_above();
          // unmake_above() only drops the always-on-top pin; e2e
          // (test_fullscreen_demote_float) showed the float still stacks above
          // the fullscreen window in the normal layer, so lower it explicitly.
          metaWindow.lower();
          w._aboveDemotedForFullscreen = true;
          return;
        }

        // Restore: a previously-demoted float whose monitor is now clear.
        if (!blocked && w._aboveDemotedForFullscreen) {
          if (w._forgeSetAbove && !metaWindow.is_above()) metaWindow.make_above();
          w._aboveDemotedForFullscreen = false;
        }
      });
    });
  }

  /** forge-zo4: re-pin every float Forge demoted for a fullscreen window. */
  _restoreAllDemotedFloats() {
    if (!this.tree) return;
    this._withSuppressedAboveHandler(() => {
      this.allNodeWindows.forEach((w) => {
        if (!w._aboveDemotedForFullscreen) return;
        const metaWindow = w.nodeValue;
        if (w._forgeSetAbove && metaWindow && !metaWindow.is_above()) metaWindow.make_above();
        w._aboveDemotedForFullscreen = false;
      });
    });
  }

  /**
   * forge-zo4: run `fn` while suppressing _handleUserAboveChange so Forge's own
   * make_above/unmake_above (which emit notify::above) are not mistaken for the
   * user toggling "Always on Top".
   */
  _withSuppressedAboveHandler(fn) {
    const prev = this._suppressAboveHandler;
    this._suppressAboveHandler = true;
    try {
      fn();
    } finally {
      this._suppressAboveHandler = prev;
    }
  }

  /** forge-zo4: dialogs/transients are always-above by design — never demote them. */
  _isDialogLike(metaWindow) {
    return (
      metaWindow.get_window_type() === Meta.WindowType.DIALOG ||
      metaWindow.get_window_type() === Meta.WindowType.MODAL_DIALOG ||
      metaWindow.get_transient_for() !== null
    );
  }

  /**
   * forge-zo4: monitor index for a window node — tree ancestor first
   * (authoritative for tree-scoped reasoning), else the window's own monitor.
   */
  _monitorIndexOfNode(node) {
    const monNode = this.tree.findAncestorMonitor(node);
    if (monNode) return Utils.monitorIndex(monNode.nodeValue);
    return node.nodeValue ? node.nodeValue.get_monitor() : -1;
  }

  trackCurrentMonWs() {
    let metaWindow = this.focusMetaWindow;
    if (!metaWindow) return;
    const currentMonitor = global.display.get_current_monitor();
    const currentWorkspace = global.display.get_workspace_manager().get_active_workspace_index();

    let currentMonWs = Utils.createMonitorWorkspaceId(currentMonitor, currentWorkspace);
    let activeMetaMonWs = Utils.createMonitorWorkspaceId(
      metaWindow.get_monitor(),
      metaWindow.get_workspace().index()
    );
    let currentWsNode = this.tree.findNode(`ws${currentWorkspace}`);

    if (!currentWsNode) {
      return;
    }

    // Search for all the valid windows on the workspace
    const monWindows = currentWsNode.getNodeByType(NODE_TYPES.WORKSPACE).flatMap((ws) => {
      return ws
        .getNodeByType(NODE_TYPES.WINDOW)
        .filter(
          (w) =>
            !w.nodeValue.minimized &&
            w.isTile() &&
            w.nodeValue !== metaWindow &&
            // The searched window should be on the same monitor workspace
            // This ensures that Forge already updated the workspace node tree:
            currentMonWs === activeMetaMonWs
        )
        .map((w) => w.nodeValue);
    });

    this.sortedWindows = global.display.sort_windows_by_stacking(monWindows).reverse();
  }

  /**
   * Bind signals to a workspace for window tracking.
   * Delegates to WorkspaceManager.
   * @param {Meta.Workspace} metaWorkspace - The workspace to bind signals to
   */
  bindWorkspaceSignals(metaWorkspace) {
    if (this.tree && this.tree.workspaceManager) {
      this.tree.workspaceManager.bindWorkspaceSignals(metaWorkspace);
    }
  }

  /**
   * Execute a command action.
   * Delegates to CommandHandler.
   * @param {Object} action - The action to execute
   */
  command(action) {
    this._commandHandler.execute(action);
  }

  resize(grabOp, amount) {
    let metaWindow = this.focusMetaWindow;
    if (!metaWindow) return;
    let display = global.display;

    this._handleGrabOpBegin(display, metaWindow, grabOp);

    let rect = metaWindow.get_frame_rect();
    let direction = Utils.directionFromGrab(grabOp);

    switch (direction) {
      case Meta.MotionDirection.RIGHT:
        rect.width = rect.width + amount;
        break;
      case Meta.MotionDirection.LEFT:
        rect.width = rect.width + amount;
        rect.x = rect.x - amount;
        break;
      case Meta.MotionDirection.UP:
        rect.height = rect.height + amount;
        break;
      case Meta.MotionDirection.DOWN:
        rect.height = rect.height + amount;
        rect.y = rect.y - amount;
        break;
    }
    this.move(metaWindow, rect);

    // Bug #532 (forge-5v6): on key auto-repeat each press calls resize() again.
    // Restart a single debounced grab-end instead of queueing one per press, so
    // the grab (and its frozen initRect) stays open for the whole hold and the
    // resize accumulates smoothly; the layout settles once the key is released.
    if (this._manualResizeEndId) {
      GLib.source_remove(this._manualResizeEndId);
    }
    this._manualResizeEndId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
      this._manualResizeEndId = 0;
      this._handleGrabOpEnd(display, metaWindow, grabOp);
      return false;
    });
  }

  disable() {
    Utils._disableDecorations();
    this._removeSignals();
    // forge-zo4: re-pin any floats demoted for a fullscreen window before the
    // tree is dropped, so they aren't stranded below after Forge is disabled.
    // Done after _removeSignals so the make_above notify::above can't re-render.
    this._restoreAllDemotedFloats();
    // Release any preview hint left over from an in-progress drag before dropping the tree.
    this.allNodeWindows.forEach((node) => this._grabCleanup(node));
    this._draggedNodeWindow = null;
    if (this._tree && this._tree._waylandStackingTimeoutId) {
      GLib.Source.remove(this._tree._waylandStackingTimeoutId);
      this._tree._waylandStackingTimeoutId = 0;
    }
    this._tree = null;
    this.disabled = true;
    Logger.debug(`extension:disable`);
  }

  enable() {
    this._bindSignals();
    this.reloadTree("enable");
    Logger.debug(`extension:enable`);
  }

  findNodeWindow(metaWindow) {
    return this.tree.findNode(metaWindow);
  }

  get focusMetaWindow() {
    return global.display.get_focus_window();
  }

  get tree() {
    if (!this._tree) {
      this._tree = new Tree(this);
    }
    return this._tree;
  }

  get kbd() {
    return this._kbd;
  }

  get windowsActiveWorkspace() {
    let wsManager = global.workspace_manager;
    return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, wsManager.get_active_workspace());
  }

  get windowsAllWorkspaces() {
    let wsManager = global.workspace_manager;
    let windowsAll = [];

    for (let i = 0; i < wsManager.get_n_workspaces(); i++) {
      windowsAll.push(
        ...global.display.get_tab_list(Meta.TabList.NORMAL_ALL, wsManager.get_workspace_by_index(i))
      );
    }
    windowsAll.sort((w1, w2) => {
      return w1.get_stable_sequence() - w2.get_stable_sequence();
    });
    return windowsAll;
  }

  getWindowsOnWorkspace(workspaceIndex) {
    const workspaceNode = this.tree.findNode(`ws${workspaceIndex}`);
    const workspaceWindows = workspaceNode.getNodeByType(NODE_TYPES.WINDOW);
    return workspaceWindows;
  }

  _handleLayoutModeToggle(settingName, layoutType) {
    let settings = this.ext.settings;
    if (!settings.get_boolean(settingName)) {
      let nodes = this.tree.getNodeByLayout(layoutType);
      nodes.forEach((node) => {
        node.prevLayout = node.layout;
        node.layout = this.determineSplitLayout();
      });
    } else {
      let splitNodes = this.tree.getNodeByLayout(LAYOUT_TYPES.HSPLIT);
      splitNodes.push(...this.tree.getNodeByLayout(LAYOUT_TYPES.VSPLIT));
      splitNodes.forEach((node) => {
        if (node.prevLayout && node.prevLayout === layoutType) {
          node.layout = layoutType;
        }
      });
    }
    this.renderTree(settingName);
  }

  determineSplitLayout() {
    // if the monitor width is less than height, the monitor could be vertical orientation;
    let monitorRect = global.display.get_monitor_geometry(global.display.get_current_monitor());
    if (monitorRect.width < monitorRect.height) {
      return LAYOUT_TYPES.VSPLIT;
    }
    return LAYOUT_TYPES.HSPLIT;
  }

  /**
   * Bug #311 fix: Determine split layout based on a given rect's dimensions
   * For nested splits, use the container's available space instead of monitor dimensions.
   * @param {Object} rect - Rectangle with width and height properties
   * @returns {string} LAYOUT_TYPES.VSPLIT or LAYOUT_TYPES.HSPLIT
   */
  determineSplitLayoutForRect(rect) {
    if (!rect) return this.determineSplitLayout();
    if (rect.width < rect.height) {
      return LAYOUT_TYPES.VSPLIT;
    }
    return LAYOUT_TYPES.HSPLIT;
  }

  /**
   * Feature #398: Get the default layout for new containers
   * Returns LAYOUT_TYPES based on default-window-layout setting
   */
  getDefaultLayout() {
    const defaultLayout = this.ext.settings.get_string("default-window-layout");
    switch (defaultLayout) {
      case "tabbed":
        return LAYOUT_TYPES.TABBED;
      case "stacked":
        return LAYOUT_TYPES.STACKED;
      case "tiled":
      default:
        return this.determineSplitLayout();
    }
  }

  /**
   * Apply default layout to a container after creation
   * Called after tree.split() to set tabbed/stacked if configured
   */
  applyDefaultLayoutToContainer(container) {
    if (!container) return;
    const defaultLayout = this.ext.settings.get_string("default-window-layout");
    if (defaultLayout === "tabbed" && this.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) {
      container.layout = LAYOUT_TYPES.TABBED;
    } else if (
      defaultLayout === "stacked" &&
      this.ext.settings.get_boolean("stacked-tiling-mode-enabled")
    ) {
      container.layout = LAYOUT_TYPES.STACKED;
    }
  }

  floatWorkspace(workspaceIndex) {
    const workspaceWindows = this.getWindowsOnWorkspace(workspaceIndex);
    if (!workspaceWindows) return;
    workspaceWindows.forEach((w) => {
      w.float = true;
    });
  }

  unfloatWorkspace(workspaceIndex) {
    const workspaceWindows = this.getWindowsOnWorkspace(workspaceIndex);
    if (!workspaceWindows) return;
    workspaceWindows.forEach((w) => {
      w.tile = true;
    });
  }

  /**
   * Feature #287: Toggle monocle mode - tab all windows on current workspace
   * When enabled, all tiled windows move to a single tabbed container
   * When disabled, returns to normal tiled layout
   */
  toggleWorkspaceMonocle() {
    const workspaceIndex = global.display.get_workspace_manager().get_active_workspace_index();
    const workspaceNode = this.tree.findNode(`ws${workspaceIndex}`);
    if (!workspaceNode) return;

    // Find the first monitor container in this workspace
    const monitorNodes = workspaceNode.getNodeByType(NODE_TYPES.MONITOR);
    if (!monitorNodes || monitorNodes.length === 0) return;

    const monitorNode = monitorNodes[0];
    const tiledWindows = this.tree.getTiledChildren(monitorNode.childNodes);

    if (tiledWindows.length === 0) return;

    // Check if we're already in monocle mode (single tabbed container with all windows)
    const containerNodes = monitorNode.getNodeByType(NODE_TYPES.CON);
    const isMonocle =
      containerNodes.length === 1 &&
      containerNodes[0].layout === LAYOUT_TYPES.TABBED &&
      containerNodes[0].childNodes.length > 1;

    if (isMonocle) {
      // Exit monocle: change container to split layout
      containerNodes[0].layout = this.determineSplitLayout();
      this.tree.resetSiblingPercent(containerNodes[0]);
    } else {
      // Enter monocle: gather all tiled LEAF windows (recursively, across any
      // existing containers) and move them into one tabbed container.
      //
      // forge-a34.7: the original code called the non-existent
      // this.tree.moveNode and threw. A naive fix using
      // getTiledChildren(monitorNode.childNodes) is also wrong: that returns the
      // monitor's *direct* children, which for a nested layout is the CON node
      // itself (not the windows inside it) — appending that CON into itself
      // makes a self-referential cycle and renderTree recurses forever. So we
      // collect leaf WINDOW nodes (getNodeByType is recursive) and never append
      // a container into itself.
      let leafWindows = monitorNode
        .getNodeByType(NODE_TYPES.WINDOW)
        .filter((w) => !w.isFloat() && !w.isGrabTile() && !w.nodeValue.minimized);
      if (leafWindows.length === 0) return;

      let targetContainer = containerNodes[0];
      if (!targetContainer) {
        // No container yet: push the first window down into a fresh container.
        // split() replaces the window node with a new one inside the container,
        // so re-collect the leaf set afterwards.
        this.tree.split(leafWindows[0], ORIENTATION_TYPES.HORIZONTAL, true);
        targetContainer = leafWindows[0].parentNode;
        leafWindows = monitorNode
          .getNodeByType(NODE_TYPES.WINDOW)
          .filter((w) => !w.isFloat() && !w.isGrabTile() && !w.nodeValue.minimized);
      }

      // Node.appendChild reparents (removing from the previous parent first).
      for (const window of leafWindows) {
        if (window.parentNode !== targetContainer) {
          targetContainer.appendChild(window);
        }
      }

      // Prune containers left empty by the moves so the monitor keeps exactly
      // one container — the exit path detects monocle via
      // containerNodes.length === 1, and a surviving empty/nested CON would
      // make the next toggle re-enter instead of restoring the split. Loop
      // until stable because removing a child CON can empty its parent.
      let prunedAny = true;
      while (prunedAny) {
        prunedAny = false;
        for (const con of monitorNode.getNodeByType(NODE_TYPES.CON)) {
          if (con !== targetContainer && con.childNodes.length === 0 && con.parentNode) {
            con.parentNode.removeChild(con);
            prunedAny = true;
          }
        }
      }

      // The container may carry a partial-width percent (e.g. inherited from the
      // split above); reset its siblings so the monocle container fills the
      // monitor work area instead of rendering at the pre-monocle width.
      this.tree.resetSiblingPercent(targetContainer.parentNode);
      targetContainer.layout = LAYOUT_TYPES.TABBED;
      targetContainer.lastTabFocus = this.focusMetaWindow;
    }

    this.renderTree("workspace-monocle-toggle");
  }

  hideActorBorder(actor) {
    // Ensure borders are hidden regardless of state (#268)
    if (actor && actor.border) {
      try {
        actor.border.hide();
      } catch (e) {
        Logger.warn(`Failed to hide border: ${e}`);
      }
    }
    if (actor && actor.splitBorder) {
      try {
        actor.splitBorder.hide();
      } catch (e) {
        Logger.warn(`Failed to hide splitBorder: ${e}`);
      }
    }
  }

  hideWindowBorders() {
    // Ensure we iterate even if tree is in unexpected state (#268)
    const nodeWindows = this.tree.nodeWindows || [];
    nodeWindows.forEach((nodeWindow) => {
      let actor = nodeWindow.windowActor;
      if (actor) {
        this.hideActorBorder(actor);
      }
      if (nodeWindow.parentNode && nodeWindow.parentNode.isTabbed()) {
        // Check if tab widget exists and is still valid before modifying
        if (nodeWindow.tab && !nodeWindow.tab._destroyed && nodeWindow.tab.get_parent()) {
          nodeWindow.tab.remove_style_class_name("window-tabbed-tab-active");
        }
      }
    });
  }

  // Window movement API
  // Bug #224 fix: Align dimension to buffer scale (for Wayland HiDPI)
  _alignToBufferScale(value, scale = 2) {
    return Math.round(value / scale) * scale;
  }

  move(metaWindow, rect) {
    if (!metaWindow) return;
    if (metaWindow.grabbed) return;
    Compat.unmaximize(metaWindow);

    let windowActor = metaWindow.get_compositor_private();
    if (!windowActor) return;
    // Bug #530: keep the map/open effect (GNOME Shell's or an animation
    // extension's like Burn My Windows) on a new window's first placement.
    // Forge never adds actor transitions itself, so stripping is only needed
    // on later re-renders to cancel in-flight shell effects.
    if (metaWindow.firstRender) {
      metaWindow.firstRender = false;
    } else {
      windowActor.remove_all_transitions();
    }

    // Bug #224 fix: Align dimensions to buffer scale on Wayland
    let x = rect.x;
    let y = rect.y;
    let width = rect.width;
    let height = rect.height;

    // Keep a window that can't shrink to its slot within the work area, so its
    // controls (close button) stay reachable instead of spilling off the edge.
    const hints = metaWindow.get_size_hints?.();
    const minW = hints?.min_width ?? width;
    const minH = hints?.min_height ?? height;
    if (minW > width || minH > height) {
      const wa = metaWindow.get_work_area_current_monitor();
      if (minW > width) x = Math.max(wa.x, Math.min(x, wa.x + wa.width - minW));
      if (minH > height) y = Math.max(wa.y, Math.min(y, wa.y + wa.height - minH));
    }

    if (Meta.is_wayland_compositor && Meta.is_wayland_compositor()) {
      const scale = Utils.dpi(); // Get display scale factor
      if (scale > 1) {
        x = this._alignToBufferScale(x, scale);
        y = this._alignToBufferScale(y, scale);
        width = this._alignToBufferScale(width, scale);
        height = this._alignToBufferScale(height, scale);
      }
    }

    metaWindow.move_frame(true, x, y);
    metaWindow.move_resize_frame(true, x, y, width, height);
  }

  moveCenter(metaWindow) {
    if (!metaWindow) return;
    let frameRect = metaWindow.get_frame_rect();
    const rectRequest = {
      x: "center",
      y: "center",
      width: frameRect.width,
      height: frameRect.height,
    };

    this.move(metaWindow, Utils.resolveRect(rectRequest, metaWindow));
  }

  rectForMonitor(node, targetMonitor) {
    if (!node || (node && node.nodeType !== NODE_TYPES.WINDOW)) return null;
    if (targetMonitor < 0) return null;
    let currentWorkArea = node.nodeValue.get_work_area_current_monitor();
    let nextWorkArea = node.nodeValue.get_work_area_for_monitor(targetMonitor);

    if (currentWorkArea && nextWorkArea) {
      let rect = node.rect;
      if (!rect && node.mode === WINDOW_MODES.FLOAT) {
        rect = node.nodeValue.get_frame_rect();
      }
      let hRatio = 1;
      let wRatio = 1;

      hRatio = nextWorkArea.height / currentWorkArea.height;
      wRatio = nextWorkArea.width / currentWorkArea.width;
      rect.height *= hRatio;
      rect.width *= wRatio;

      if (nextWorkArea.y < currentWorkArea.y) {
        rect.y =
          ((nextWorkArea.y + rect.y - currentWorkArea.y) / currentWorkArea.height) *
          nextWorkArea.height;
      } else if (nextWorkArea.y > currentWorkArea.y) {
        rect.y = (rect.y / currentWorkArea.height) * nextWorkArea.height + nextWorkArea.y;
      }

      if (nextWorkArea.x < currentWorkArea.x) {
        rect.x =
          ((nextWorkArea.x + rect.x - currentWorkArea.x) / currentWorkArea.width) *
          nextWorkArea.width;
      } else if (nextWorkArea.x > currentWorkArea.x) {
        rect.x = (rect.x / currentWorkArea.width) * nextWorkArea.width + nextWorkArea.x;
      }
      return rect;
    }
    return null;
  }

  _clearTimeoutId(propertyName) {
    if (this[propertyName]) {
      GLib.Source.remove(this[propertyName]);
      this[propertyName] = 0;
    }
  }

  _removeSignals() {
    if (!this._signalsBound) return;

    disconnectSignals(this.ext.settings, this._settingsSignals);
    this._settingsSignals = undefined;

    disconnectSignals(global.display, this._displaySignals);
    this._displaySignals = undefined;

    disconnectSignals(global.window_manager, this._windowManagerSignals);
    this._windowManagerSignals = undefined;

    const globalWsm = global.workspace_manager;

    disconnectSignals(globalWsm, this._workspaceManagerSignals);
    this._workspaceManagerSignals = undefined;

    // Clean up workspace signals via WorkspaceManager
    if (this.tree?.workspaceManager) {
      this.tree.workspaceManager.destroy();
    }

    let allWindows = this.windowsAllWorkspaces;

    if (allWindows) {
      for (let metaWindow of allWindows) {
        disconnectSignals(metaWindow, metaWindow.windowSignals);
        metaWindow.windowSignals = undefined;

        let windowActor = metaWindow.get_compositor_private();
        if (windowActor) {
          disconnectSignals(windowActor, windowActor.actorSignals);
          windowActor.actorSignals = undefined;
        }

        if (windowActor && windowActor.border) {
          windowActor.border.hide();
          if (global.window_group) {
            global.window_group.remove_child(windowActor.border);
          }
          windowActor.border = undefined;
        }

        if (windowActor && windowActor.splitBorder) {
          windowActor.splitBorder.hide();
          if (global.window_group) {
            global.window_group.remove_child(windowActor.splitBorder);
          }
          windowActor.splitBorder = undefined;
        }
      }
    }

    this._clearTimeoutId("_renderTreeSrcId");
    this._clearTimeoutId("_reloadTreeSrcId");
    this._clearTimeoutId("_wsWindowAddSrcId");
    this._clearTimeoutId("_windowHomeReconcileSrcId");
    this._clearTimeoutId("_queueSourceId");
    this._clearTimeoutId("_manualResizeEndId");
    this._clearTimeoutId("_pointerFocusTimeoutId");
    this._clearTimeoutId("_prefsOpenSrcId");

    disconnectSignals(Main.overview, this._overviewSignals);
    this._overviewSignals = null;

    this._signalsBound = false;
  }

  renderTree(from, force = false) {
    let wasFrozen = this._freezeRender;
    if (force && wasFrozen) this.unfreezeRender();
    if (this._freezeRender || !this.ext.settings.get_boolean("tiling-mode-enabled")) {
      this.updateDecorationLayout();
      this.updateBorderLayout();
    } else {
      if (!this._renderTreeSrcId) {
        this._renderTreeSrcId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          try {
            this.processFloats();
            // forge-zo4: processFloats re-pins always-on-top floats via `set float`,
            // so the fullscreen demotion must run AFTER it to win, on every render.
            this._reconcileFullscreenFloatDemotion();
            this.tree.render(from);
            this.handleMaximizeOnSingle();
            this.updateDecorationLayout();
            this.updateBorderLayout();
          } finally {
            // Bug #531: a throw above must not leave the id set, or every
            // future renderTree() no-ops and new windows stay floating.
            this._renderTreeSrcId = 0;
            if (wasFrozen) this.freezeRender();
          }
          return false;
        });
      }
    }
  }

  processFloats() {
    this.allNodeWindows.forEach((nodeWindow) => {
      let metaWindow = nodeWindow.nodeValue;
      // Feature #295: Also check if monitor should be tiled
      if (
        this.isFloatingExempt(metaWindow) ||
        !this.isActiveWindowWorkspaceTiled(metaWindow) ||
        !this.isActiveWindowMonitorTiled(metaWindow)
      ) {
        nodeWindow.float = true;
        this._repositionOccludedDialog(metaWindow);
      } else {
        nodeWindow.float = false;
      }
    });
  }

  /**
   * forge-2ew: A transient dialog can inherit Mutter placement that lands it
   * behind a tiled neighbor of its parent. When a dialog overlaps a tiled window
   * other than its own parent, recenter it over its parent (clamped to the work
   * area) so it is not occluded. Non-transient floats are left where the user
   * put them.
   */
  _repositionOccludedDialog(metaWindow) {
    const parent = metaWindow.get_transient_for && metaWindow.get_transient_for();
    if (!parent) return;

    const dialogRect = metaWindow.get_frame_rect();
    const occluded = this.allNodeWindows.some((n) => {
      const w = n.nodeValue;
      return n.isTile() && w && w !== parent && Utils.rectsOverlap(dialogRect, w.get_frame_rect());
    });
    if (!occluded) return;

    const parentRect = parent.get_frame_rect();
    let x = parentRect.x + Math.floor((parentRect.width - dialogRect.width) / 2);
    let y = parentRect.y + Math.floor((parentRect.height - dialogRect.height) / 2);

    const wa = metaWindow.get_work_area_current_monitor();
    if (wa) {
      x = Math.max(wa.x, Math.min(x, wa.x + wa.width - dialogRect.width));
      y = Math.max(wa.y, Math.min(y, wa.y + wa.height - dialogRect.height));
    }

    this.move(metaWindow, { x, y, width: dialogRect.width, height: dialogRect.height });
  }

  /**
   * forge-w7e (#469): React to a window's "Always on Top" state changing.
   *
   * "Always on Top" is GNOME's Z-axis stacking pin (make_above). isFloatingExempt
   * treats an above window as floating, so a re-render is all that's needed to
   * move a newly-pinned window out of the tree (and retile it when unpinned).
   * Forge only ever pins windows it is already floating, so this stays a no-op
   * for normal tiled windows until the user toggles always-on-top.
   */
  _handleUserAboveChange(_metaWindow) {
    // forge-zo4: ignore the notify::above that Forge itself emits while demoting
    // or restoring floats around a fullscreen window — only react to user pins.
    if (this._suppressAboveHandler) return;
    this.renderTree("notify-above");
  }

  get allNodeWindows() {
    return this.tree.getNodeByType(NODE_TYPES.WINDOW);
  }

  /**
   * Reloads the tree. This is an expensive operation.
   * Useful when using dynamic workspaces in GNOME-shell.
   * Delegates tree operations to tree.reload().
   *
   * @param {string} from - Debug identifier for where reload was triggered
   */
  reloadTree(from) {
    if (!this._reloadTreeSrcId) {
      this._reloadTreeSrcId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
        try {
          // forge-bqa: capture stacked/tabbed groupings (in-memory only) before
          // reload() wipes the tree, then restore them after the windows are
          // re-tracked flat, so a reload (e.g. extension re-enable on resume)
          // doesn't drop the user's stacks/tabs.
          const layoutGroups = this.tree.snapshotLayoutGroups();
          // Delegate tree structure reload to Tree class
          this.tree.reload();
          // WindowManager handles window tracking and rendering
          this.trackCurrentWindows();
          this.tree.restoreLayoutGroups(layoutGroups);
          this.renderTree(from);
        } finally {
          // Always clear the id; otherwise a throw mid-reload would leave it set
          // and the guard above would block every future reloadTree this session.
          this._reloadTreeSrcId = 0;
        }
        return false;
      });
    }
  }

  sameParentMonitor(firstNode, secondNode) {
    if (!firstNode || !secondNode) return false;
    if (!firstNode.nodeValue || !secondNode.nodeValue) return false;
    if (!firstNode.nodeValue.get_workspace()) return false;
    if (!secondNode.nodeValue.get_workspace()) return false;
    let firstMonWs = Utils.createMonitorWorkspaceId(
      firstNode.nodeValue.get_monitor(),
      firstNode.nodeValue.get_workspace().index()
    );
    let secondMonWs = Utils.createMonitorWorkspaceId(
      secondNode.nodeValue.get_monitor(),
      secondNode.nodeValue.get_workspace().index()
    );
    return firstMonWs === secondMonWs;
  }

  showWindowBorders() {
    let metaWindow = this.focusMetaWindow;
    if (!metaWindow) return;
    let windowActor = metaWindow.get_compositor_private();
    if (!windowActor) return;
    let nodeWindow = this.findNodeWindow(metaWindow);
    if (!nodeWindow) return;
    if (metaWindow.get_wm_class() === null) return;

    let borders = [];
    let focusBorderEnabled = this.ext.settings.get_boolean("focus-border-toggle");
    let focusBorderHiddenOnSingle = this.ext.settings.get_boolean("focus-border-hidden-on-single");
    let splitBorderEnabled = this.ext.settings.get_boolean("split-border-toggle");
    let tilingModeEnabled = this.ext.settings.get_boolean("tiling-mode-enabled");
    let gap = this.calculateGaps(nodeWindow);
    let maximized = () => Compat.isMaximized(metaWindow) || metaWindow.is_fullscreen() || gap === 0;
    let monitorCount = global.display.get_n_monitors();
    let monitorNode = this.tree.findParent(nodeWindow, NODE_TYPES.MONITOR);
    let tiledChildren = monitorNode
      ? monitorNode
          .getNodeByMode(WINDOW_MODES.TILE)
          .filter((t) => t.isWindow() && !t.nodeValue.minimized)
      : [];
    let inset = 3;
    let parentNode = nodeWindow.parentNode;

    const floatingWindow = nodeWindow.isFloat();
    const tiledBorder = windowActor.border;

    if (parentNode.isTabbed()) {
      if (nodeWindow.tab) {
        nodeWindow.tab.add_style_class_name("window-tabbed-tab-active");
      }
    }

    // Feature #262: Skip focus border if single window and setting enabled
    let isSingleWindow = tiledChildren.length === 1 && monitorCount === 1;
    let skipBorderForSingle = focusBorderHiddenOnSingle && isSingleWindow && !floatingWindow;

    if (tiledBorder && focusBorderEnabled && !skipBorderForSingle) {
      if (
        !maximized() ||
        (gap === 0 && tiledChildren.length === 1 && monitorCount > 1) ||
        (gap === 0 && tiledChildren.length > 1)
      ) {
        if (tilingModeEnabled) {
          if (parentNode.isStacked()) {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-stacked-border");
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          } else if (parentNode.isTabbed()) {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-tabbed-border");
              if (nodeWindow.backgroundTab) {
                tiledBorder.add_style_class_name("window-tabbed-bg");
              }
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          } else {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-tiled-border");
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          }
          borders.push(tiledBorder);
        }
        // Feature #297: Don't show floating border when tiling is disabled
        // Previously showed window-floated-border even when tiling was off
      }
    }

    if (gap === 0 || Compat.isMaximized(metaWindow)) {
      inset = 0;
    }

    // handle the split border
    // Show split direction indicator for windows in H/V-Split containers
    if (
      splitBorderEnabled &&
      focusBorderEnabled &&
      tilingModeEnabled &&
      !nodeWindow.isFloat() &&
      !maximized() && // Bug #407/#409 fix: maximized is a function, call it
      (parentNode.isCon() || parentNode.isMonitor()) &&
      !parentNode.isStackedOrTabbed()
    ) {
      if (!windowActor.splitBorder) {
        let splitBorder = new St.Bin({ style_class: "window-split-border" });
        global.window_group.add_child(splitBorder);
        windowActor.splitBorder = splitBorder;
      }

      let splitBorder = windowActor.splitBorder;
      splitBorder.remove_style_class_name("window-split-vertical");
      splitBorder.remove_style_class_name("window-split-horizontal");

      if (parentNode.isVSplit()) {
        splitBorder.add_style_class_name("window-split-vertical");
      } else if (parentNode.isHSplit()) {
        splitBorder.add_style_class_name("window-split-horizontal");
      }
      borders.push(splitBorder);
    }

    let rect = metaWindow.get_frame_rect();

    // Bug #164 fix: align the border rect to buffer scale on Wayland HiDPI, the
    // same alignment move() applies to the window itself (see _alignToBufferScale).
    // Without this the border is sourced from the unaligned frame rect and ends up
    // offset/smaller than the window it outlines on fractional/2x scaling.
    if (rect && Meta.is_wayland_compositor && Meta.is_wayland_compositor()) {
      const scale = Utils.dpi();
      if (scale > 1) {
        rect = {
          x: this._alignToBufferScale(rect.x, scale),
          y: this._alignToBufferScale(rect.y, scale),
          width: this._alignToBufferScale(rect.width, scale),
          height: this._alignToBufferScale(rect.height, scale),
        };
      }
    }

    // Bug #164 fix: Validate rect has valid dimensions before setting border size
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    borders.forEach((border) => {
      // Ensure positive dimensions after inset adjustment
      const width = Math.max(rect.width + inset * 2, 1);
      const height = Math.max(rect.height + inset * 2, 1);
      border.set_size(width, height);
      border.set_position(rect.x - inset, rect.y - inset);
      if (metaWindow.appears_focused && !metaWindow.minimized) {
        border.show();
      }
      if (global.window_group && global.window_group.contains(border)) {
        global.window_group.remove_child(border);
        // Add the border just above the focused window
        let compositor = metaWindow.get_compositor_private();
        if (compositor) {
          global.window_group.insert_child_above(border, compositor);
        }
      }
    });

    // Ensure split border is rendered on top of tiled border
    if (
      windowActor.splitBorder &&
      windowActor.border &&
      global.window_group &&
      global.window_group.contains(windowActor.splitBorder) &&
      global.window_group.contains(windowActor.border)
    ) {
      global.window_group.set_child_above_sibling(windowActor.splitBorder, windowActor.border);
    }
  }

  updateBorderLayout() {
    this.hideWindowBorders();
    this.showWindowBorders();
  }

  calculateGaps(node) {
    if (!node) return 0;

    let settings = this.ext.settings;
    let gapSize = settings.get_uint("window-gap-size");
    let gapIncrement = settings.get_uint("window-gap-size-increment");
    let gap = gapSize * gapIncrement;

    if (!node.isRoot()) {
      let hideGapWhenSingle = settings.get_boolean("window-gap-hidden-on-single");
      let parentNode = this.tree.findParent(node, NODE_TYPES.MONITOR);
      if (parentNode) {
        let tiled = parentNode
          .getNodeByMode(WINDOW_MODES.TILE)
          .filter((t) => t.isWindow() && !t.nodeValue.minimized);
        if (tiled.length == 1 && hideGapWhenSingle) gap = 0;
      }
    }

    return gap;
  }

  /**
   * Bug #305 fix: Normalize sibling percentages to ensure they sum to 1.0
   * This prevents resize drift when resizing windows with 3+ siblings.
   * @param {Node} parentNode - The parent node containing children to normalize
   */
  _normalizeSiblingPercents(parentNode) {
    if (!parentNode) return;

    // Skip STACKED/TABBED - they don't use percent-based layout (children overlap)
    // Initializing from rect would produce invalid percents (each child rect = full container)
    // Guard against non-Node objects that might lack these methods
    if (parentNode.isStackedOrTabbed()) return;

    const children = this.tree.getTiledChildren(parentNode.childNodes);
    if (children.length <= 1) return;

    // Get parent size for calculating proportions
    const orientation = Utils.orientationFromLayout(parentNode.layout);
    const parentSize =
      orientation === ORIENTATION_TYPES.HORIZONTAL
        ? parentNode.rect?.width
        : parentNode.rect?.height;

    // First pass: initialize uninitialized children based on current rect
    children.forEach((child) => {
      if (!child.percent || child.percent <= 0) {
        // Calculate percent from current rect if available
        if (child.rect && parentSize && parentSize > 0) {
          const childSize =
            orientation === ORIENTATION_TYPES.HORIZONTAL ? child.rect.width : child.rect.height;
          child.percent = childSize / parentSize;
        } else {
          // Fallback to equal distribution
          child.percent = 1.0 / children.length;
        }
      }
    });

    // Second pass: normalize all percentages to sum to 1.0
    let totalPercent = 0;
    children.forEach((child) => {
      totalPercent += child.percent;
    });

    if (totalPercent > 0 && Math.abs(totalPercent - 1.0) > 0.001) {
      const scale = 1.0 / totalPercent;
      children.forEach((child) => {
        child.percent *= scale;
      });
    }
  }

  /**
   * Feature #315: Maximize single window when only one tiled window on monitor
   */
  /**
   * Tiled, non-minimized window nodes directly hosted on a monitor. Shared by
   * handleMaximizeOnSingle (the maximize-on-single feature) and the
   * external-maximize rejection in updateMetaPositionSize so the "sole tiled
   * window" predicate cannot drift between the two (drift would loop:
   * unmaximize -> render -> handleMaximizeOnSingle -> maximize -> ...).
   */
  _tiledWindowsOnMonitor(monitorNode) {
    if (!monitorNode) return [];
    return monitorNode
      .getNodeByMode(WINDOW_MODES.TILE)
      .filter((t) => t.isWindow() && !t.nodeValue.minimized);
  }

  handleMaximizeOnSingle() {
    let settings = this.ext.settings;
    if (!settings.get_boolean("window-maximize-on-single")) return;

    let activeWsNode = this.currentWsNode;
    if (!activeWsNode) return;

    let monitors = activeWsNode.getNodeByType(NODE_TYPES.MONITOR);
    monitors.forEach((monitor) => {
      let tiled = this._tiledWindowsOnMonitor(monitor);
      if (tiled.length === 1) {
        let metaWindow = tiled[0].nodeValue;
        // forge-fw8: a lone fullscreen window is "not maximized" — don't
        // force-maximize it, that fights the fullscreen surface.
        if (metaWindow.is_fullscreen && metaWindow.is_fullscreen()) return;
        if (Compat.isNotMaximized(metaWindow)) {
          Compat.maximize(metaWindow);
        }
      }
    });
  }

  /**
   * Feature #462: Unmaximize other windows when a new window is tiled alongside
   */
  handleUnmaximizeForTiling(newNodeWindow) {
    if (!this.ext.settings.get_boolean("auto-unmaximize-for-tiling")) return;
    if (!newNodeWindow || newNodeWindow.isFloat()) return;

    // Find the monitor node for this window
    const monitorNode = this.tree.findParent(newNodeWindow, NODE_TYPES.MONITOR);
    if (!monitorNode) return;

    // Get all windows on this monitor
    const windows = monitorNode.getNodeByType(NODE_TYPES.WINDOW);

    windows.forEach((nodeWindow) => {
      if (nodeWindow === newNodeWindow) return;
      if (nodeWindow.isFloat()) return;

      const metaWindow = nodeWindow.nodeValue;
      if (!metaWindow || metaWindow.minimized) return;

      if (Compat.isMaximized(metaWindow)) {
        Compat.unmaximize(metaWindow);
      }
    });
  }

  /**
   * Track meta/mutter windows and append them to the tree.
   * Windows can be attached on any of the following Node Types:
   * MONITOR, CONTAINER
   *
   */
  trackWindow(_display, metaWindow) {
    let autoSplit = this.ext.settings.get_boolean("auto-split-enabled");
    if (autoSplit && this.focusMetaWindow) {
      let currentFocusNode = this.tree.findNode(this.focusMetaWindow);
      if (currentFocusNode) {
        let currentParentFocusNode = currentFocusNode.parentNode;
        let layout = currentParentFocusNode.layout;
        if (layout === LAYOUT_TYPES.HSPLIT || layout === LAYOUT_TYPES.VSPLIT) {
          let frameRect = this.focusMetaWindow.get_frame_rect();
          let splitHorizontal = frameRect.width > frameRect.height;
          let orientation = splitHorizontal ? "horizontal" : "vertical";
          this.command({ name: "Split", orientation: orientation });
        }
      }
    }
    // Make window types configurable
    if (this._validWindow(metaWindow)) {
      let existNodeWindow = this.tree.findNode(metaWindow);
      Logger.debug(`Meta Window ${metaWindow.get_title()} ${metaWindow.get_window_type()}`);
      if (!existNodeWindow) {
        let attachTarget;

        // forge-tnth (#299/#427/#388/#353): where to initially home a new window.
        // 'pointer' (default) uses the active/pointer monitor as before;
        // 'window-actual' places it on the window's own monitor from the start,
        // matching where updateMetaWorkspaceMonitor would re-home it anyway and
        // avoiding a redundant re-home for apps that restore their own geometry.
        const placement = this.ext.settings.get_string("new-window-placement");
        const activeMonitor =
          placement === "window-actual"
            ? metaWindow.get_monitor()
            : global.display.get_current_monitor();
        const activeWorkspace = global.display.get_workspace_manager().get_active_workspace_index();
        let metaMonWs = Utils.createMonitorWorkspaceId(activeMonitor, activeWorkspace);

        // Check if the active monitor / workspace has windows
        let metaMonWsNode = this.tree.findNode(metaMonWs);
        if (!metaMonWsNode) {
          // Reload the tree as a last resort
          this.reloadTree("no-meta-monws");
          return;
        }

        let windowNodes = metaMonWsNode.getNodeByType(NODE_TYPES.WINDOW);
        let hasWindows = windowNodes.length > 0;

        attachTarget = this.tree.attachNode;
        attachTarget = attachTarget ? this.tree.findNode(attachTarget.nodeValue) : null;

        // Feature #227: Use last focused window as fallback when no attach target
        if (!attachTarget && this.lastFocusedWindow) {
          const lastFocusNode = this.tree.findNode(this.lastFocusedWindow.nodeValue);
          if (lastFocusNode && metaMonWsNode.contains(lastFocusNode)) {
            attachTarget = lastFocusNode;
          }
        }

        if (!attachTarget) {
          attachTarget = metaMonWsNode;
        } else {
          if (hasWindows) {
            if (attachTarget && metaMonWsNode.contains(attachTarget)) {
              // Use the attach target
            } else {
              // Find the first window
              attachTarget = windowNodes[0];
            }
          } else {
            attachTarget = metaMonWsNode;
          }
        }

        let nodeWindow = this.tree.createNode(
          attachTarget.nodeValue,
          NODE_TYPES.WINDOW,
          metaWindow,
          WINDOW_MODES.FLOAT
        );

        metaWindow.firstRender = true;

        let windowActor = metaWindow.get_compositor_private();

        if (!metaWindow.windowSignals) {
          let windowSignals = [
            metaWindow.connect("position-changed", (_metaWindow) => {
              let from = "position-changed";
              this.updateMetaPositionSize(_metaWindow, from);
            }),
            metaWindow.connect("size-changed", (_metaWindow) => {
              let from = "size-changed";
              this.updateMetaPositionSize(_metaWindow, from);
            }),
            metaWindow.connect("unmanaged", (_metaWindow) => {
              this.hideActorBorder(windowActor);
            }),
            metaWindow.connect("focus", (_metaWindowFocus) => {
              this.queueEvent({
                name: "focus-update",
                callback: () => {
                  this.unfreezeRender();
                  this.updateBorderLayout();
                  this.updateDecorationLayout();
                  this.updateStackedFocus();
                  this.updateTabbedFocus();
                  let focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
                  this.movePointerWith(focusNodeWindow);
                },
              });
              let focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
              if (focusNodeWindow) {
                // handle the attach node
                this.tree.attachNode = focusNodeWindow._parent;
                if (this.floatingWindow(focusNodeWindow)) {
                  this.queueEvent({
                    name: "raise-float",
                    callback: () => {
                      this.renderTree("raise-float-queue");
                    },
                  });
                }
                this.tree.attachNode = focusNodeWindow;
              }
              this.renderTree("focus", true);
            }),
            metaWindow.connect("workspace-changed", (_metaWindow) => {
              // forge-6pe: coalesce bursts of workspace-changed (GNOME's
              // insertWorkspace moves many windows synchronously) into one
              // settled reconcile so nested layouts are not flattened.
              this._queueWindowHomeReconcile();
            }),
            metaWindow.connect("notify::above", (_metaWindow) => {
              // forge-w7e (#469): a user pinning a tiled window "Always on Top"
              // should float it out of the tree, and unsetting returns it to tile.
              this._handleUserAboveChange(_metaWindow);
            }),
            metaWindow.connect("notify::wm-class", (_metaWindow) => {
              // forge-3qq (#482): some apps (Anki, Opera, many Flatpaks) report a
              // null wm_class at map time, so isFloatingExempt floats them and they
              // never auto-tile. Re-render once the class lands so processFloats can
              // re-evaluate; renderTree debounces to a single idle pass.
              this.renderTree("wm-class-changed");
            }),
          ];
          metaWindow.windowSignals = windowSignals;
        }

        if (!windowActor.actorSignals) {
          let actorSignals = [windowActor.connect("destroy", this.windowDestroy.bind(this))];
          windowActor.actorSignals = actorSignals;
        }

        if (!windowActor.border) {
          let border = new St.Bin({ style_class: "window-tiled-border" });

          if (global.window_group) global.window_group.add_child(border);

          windowActor.border = border;
          border.show();
        }

        this.postProcessWindow(nodeWindow);

        // Feature #462: Unmaximize other windows when new window tiled alongside
        this.handleUnmaximizeForTiling(nodeWindow);

        this.queueEvent(
          {
            name: "window-create-queue",
            callback: () => {
              Compat.unmaximize(metaWindow);
              this.renderTree("window-create", true);
            },
          },
          200
        );

        // forge-7m3: Give the new window a fair share while preserving the
        // existing windows' custom proportions, instead of zeroing every sibling
        // (which forced an equal re-split and discarded user resizes).
        this.tree.insertChildPercent(nodeWindow.parentNode, nodeWindow);
      }
    }
  }

  postProcessWindow(nodeWindow) {
    let metaWindow = nodeWindow.nodeValue;
    if (metaWindow) {
      if (metaWindow.get_title() === this.prefsTitle) {
        metaWindow
          .get_workspace()
          .activate_with_focus(metaWindow, global.display.get_current_time());
        this.moveCenter(metaWindow);
      } else {
        this.movePointerWith(metaWindow);
      }
    }
  }

  updateStackedFocus(focusNodeWindow) {
    if (!focusNodeWindow || !focusNodeWindow.parentNode) return;
    const parentNode = focusNodeWindow.parentNode;
    if (parentNode.layout === LAYOUT_TYPES.STACKED && !this._freezeRender) {
      parentNode.appendChild(focusNodeWindow);
      parentNode.childNodes
        .filter((child) => child.isWindow())
        .forEach((child) => child.nodeValue.raise());
      this.queueEvent({
        name: "render-focus-stack",
        callback: () => {
          this.renderTree("focus-stacked");
        },
      });
    }
  }

  updateTabbedFocus(focusNodeWindow) {
    if (!focusNodeWindow || !focusNodeWindow.parentNode) return;
    if (focusNodeWindow.parentNode.layout === LAYOUT_TYPES.TABBED && !this._freezeRender) {
      const metaWindow = focusNodeWindow.nodeValue;
      metaWindow.raise();
    }
  }

  _isInSkipList(settingKey, value) {
    let skipStr = this.ext.settings.get_string(settingKey);
    if (!skipStr || skipStr.trim() === "") return false;
    return skipStr.split(",").some((item) => item.trim() === `${value}`);
  }

  /**
   * Check if a given workspace index is skipped for tiling.
   * @param {number} wsIndex - Workspace index to check
   * @returns {boolean} True if workspace is skipped (not tiled)
   */
  _isWorkspaceSkipped(wsIndex) {
    return this._isInSkipList("workspace-skip-tile", wsIndex);
  }

  /**
   * Check if a Meta Window's workspace is skipped for tiling.
   */
  isActiveWindowWorkspaceTiled(metaWindow) {
    if (!metaWindow) return true;
    let activeWorkspaceForWin = metaWindow.get_workspace();
    if (!activeWorkspaceForWin) return true;
    return !this._isWorkspaceSkipped(activeWorkspaceForWin.index());
  }

  /**
   * Check the current active workspace's tiling mode
   */
  isCurrentWorkspaceTiled() {
    let wsMgr = global.workspace_manager;
    let wsIndex = wsMgr.get_active_workspace_index();
    return !this._isWorkspaceSkipped(wsIndex);
  }

  /**
   * Feature #295: Check if a window's monitor should be tiled
   */
  isActiveWindowMonitorTiled(metaWindow) {
    if (!metaWindow) return true;
    return !this._isInSkipList("monitor-skip-tile", metaWindow.get_monitor());
  }

  trackCurrentWindows() {
    this.tree.attachNode = null;
    let windowsAll = this.windowsAllWorkspaces;
    for (let i = 0; i < windowsAll.length; i++) {
      let metaWindow = windowsAll[i];
      this.trackWindow(global.display, metaWindow);
      // This updates and handles dynamic workspaces
      this.updateMetaWorkspaceMonitor(
        "track-current-windows",
        metaWindow.get_monitor(),
        metaWindow
      );
    }
    this.updateDecorationLayout();
  }

  _validWindow(metaWindow) {
    // Bug #309, #322 fix: Filter out XWayland Video Bridge and ddterm windows
    const wmClass = metaWindow.get_wm_class();
    if (wmClass && wmClass.toLowerCase().includes("xwaylandvideobridge")) {
      return false;
    }
    if (wmClass && wmClass.toLowerCase().includes("ddterm")) {
      return false;
    }

    const windowType = metaWindow.get_window_type();
    if (INVALID_WINDOW_TYPES.has(windowType)) return false;
    return VALID_WINDOW_TYPES.has(windowType);
  }

  _destroyActorBorder(actor, propName) {
    const border = actor[propName];
    if (border && global.window_group) {
      global.window_group.remove_child(border);
      border.hide();
    }
  }

  windowDestroy(actor) {
    // Release any resources on the window
    this._destroyActorBorder(actor, "border");
    this._destroyActorBorder(actor, "splitBorder");

    let nodeWindow;
    nodeWindow = this.tree.findNodeByActor(actor);

    // Check if this window has focus before removing (#258)
    const metaWindow = nodeWindow?.nodeValue;
    const hadFocus = metaWindow && this.focusMetaWindow === metaWindow;

    if (nodeWindow?.isWindow()) {
      // Bug #470 (forge-6qr) / #258: snapshot the focus-restoration context while
      // the tree is still intact — removeNode detaches the node (nulls parentNode),
      // after which neither its siblings nor its workspace can be resolved.
      const focusRestore =
        hadFocus && this.ext.settings.get_boolean("tiling-mode-enabled")
          ? this._captureFocusRestore(nodeWindow)
          : null;

      this.tree.removeNode(nodeWindow);
      // forge-zo4: a closing fullscreen window does not fire in-fullscreen-changed.
      // The node is already detached, so reconciling now restores floats that were
      // demoted for it (no-op when the closed window wasn't fullscreen).
      this._reconcileFullscreenFloatDemotion();
      this.renderTree("window-destroy-quick", true);
      this.removeFloatOverride(nodeWindow.nodeValue, true);

      if (focusRestore) this._restoreFocusAfterWindowClosed(focusRestore);
    }

    // find the next attachNode here
    let focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
    if (focusNodeWindow) {
      this.tree.attachNode = focusNodeWindow.parentNode;
    }

    this.queueEvent({
      name: "window-destroy",
      callback: () => {
        this.renderTree("window-destroy", true);
      },
    });
  }

  /**
   * Bug #470 (forge-6qr) / #258: snapshot focus-restoration candidates BEFORE the
   * closed node is detached. removeNode nulls parentNode, after which siblings and
   * the owning workspace are unrecoverable from the tree. Capturing the workspace
   * NODE (not the globally active workspace) keeps restoration on the workspace the
   * window actually closed on, so closing a window never pulls focus to another one.
   */
  _captureFocusRestore(closedNodeWindow) {
    const parent = closedNodeWindow.parentNode;
    const siblings = parent
      ? parent.childNodes.filter(
          (node) => node.isWindow() && node !== closedNodeWindow && node.nodeValue
        )
      : [];
    const workspaceNode = this.tree.findAncestor(closedNodeWindow, NODE_TYPES.WORKSPACE);
    return { closedNodeWindow, siblings, workspaceNode };
  }

  _restoreFocusAfterWindowClosed(restore) {
    if (!restore) return;

    Logger.debug(`Restoring focus after window closed`);

    const activate = (metaWindow) => {
      if (!metaWindow || metaWindow.minimized) return false;
      metaWindow.raise();
      metaWindow.focus(global.display.get_current_time());
      metaWindow.activate(global.display.get_current_time());
      return true;
    };

    // Prefer a sibling in the closed window's container.
    for (const sibling of restore.siblings) {
      if (activate(sibling.nodeValue)) return;
    }

    // Otherwise, a NORMAL window on the closed window's OWN workspace. The type
    // filter (preserved from the prior implementation) keeps focus off transient
    // dialogs/utility windows, which are also tracked as tree window nodes.
    const wsNode = restore.workspaceNode;
    if (!wsNode) return;
    const candidates = wsNode
      .getNodeByType(NODE_TYPES.WINDOW)
      .filter(
        (node) =>
          node !== restore.closedNodeWindow &&
          node.nodeValue &&
          node.nodeValue.get_window_type() === Meta.WindowType.NORMAL
      );
    for (const node of candidates) {
      if (activate(node.nodeValue)) return;
    }
  }

  /**
   * Handles any workspace/monitor update for the Meta.Window.
   */
  updateMetaWorkspaceMonitor(from, _monitor, metaWindow) {
    if (this._validWindow(metaWindow)) {
      if (metaWindow.get_workspace() === null) return;
      let existNodeWindow = this.tree.findNode(metaWindow);
      let metaMonWs = Utils.createMonitorWorkspaceId(
        metaWindow.get_monitor(),
        metaWindow.get_workspace().index()
      );
      let metaMonWsNode = this.tree.findNode(metaMonWs);
      if (existNodeWindow) {
        if (existNodeWindow.parentNode && metaMonWsNode) {
          // Uses the existing workspace, monitor that the metaWindow
          // belongs to.
          let containsWindow = metaMonWsNode.contains(existNodeWindow);
          if (!containsWindow) {
            this._rehomeWindowPreservingContainer(existNodeWindow, metaWindow, metaMonWsNode);

            // Ensure that the workspace tiling is honored
            if (this.isActiveWindowWorkspaceTiled(metaWindow)) {
              if (!this.grabOp === Meta.GrabOp.WINDOW_BASE) this.updateTabbedFocus(existNodeWindow);
              this.updateStackedFocus(existNodeWindow);
            } else {
              if (this.floatingWindow(existNodeWindow)) {
                existNodeWindow.nodeValue.raise();
              }
            }
          }
        }
      }
      this.renderTree(from);
    }
  }

  /**
   * forge-6pe: Re-home a window onto `destNode`, preserving an intact sub-tree.
   *
   * If the window's enclosing container is migrating in full to the same
   * destination, the whole container is moved (walking up to the highest such
   * ancestor) so nested sub-splits / proportions survive; otherwise just the
   * window moves (the normal single-window send-to-workspace behavior).
   *
   * @param {Node} existNodeWindow - The tracked window node to re-home.
   * @param {Meta.Window} metaWindow - Its Meta.Window (defines the destination).
   * @param {Node} destNode - The destination monitor node.
   */
  _rehomeWindowPreservingContainer(existNodeWindow, metaWindow, destNode) {
    let nodeToMove = existNodeWindow;
    let ancestor = existNodeWindow.parentNode;
    while (
      ancestor &&
      ancestor.nodeType === NODE_TYPES.CON &&
      this._containerFullyMigrates(ancestor, metaWindow)
    ) {
      nodeToMove = ancestor;
      ancestor = ancestor.parentNode;
    }

    let sourceParent = nodeToMove.parentNode;
    let sourceFullyMigrates = this._containerFullyMigrates(sourceParent, metaWindow);
    destNode.appendChild(nodeToMove);
    // Only rebalance the source if it keeps windows. A fully-migrating source is
    // emptying, and rescaling it would corrupt the proportions the departing
    // windows carry to the destination.
    if (!sourceFullyMigrates) {
      this.tree.redistributeSiblingPercent(sourceParent);
    }
  }

  /**
   * forge-6pe: GNOME's WindowManager.insertWorkspace moves many windows in one
   * synchronous burst (change_workspace_by_index per window), and Mutter emits
   * each window's workspace-changed synchronously mid-loop. Re-homing eagerly on
   * each event therefore sees a half-migrated tree and flattens nested layouts.
   * Coalesce the burst into a single idle pass that runs once the batch settles,
   * so whole sub-trees can be moved intact.
   */
  _queueWindowHomeReconcile() {
    if (this._windowHomeReconcileSrcId) return;
    this._windowHomeReconcileSrcId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._windowHomeReconcileSrcId = 0;
      this._reconcileWindowHomes();
      this.trackCurrentMonWs();
      this.renderTree("workspace-changed-reconcile");
      return false;
    });
  }

  /**
   * forge-6pe: Move every tracked window whose live (monitor, workspace) no longer
   * matches its tree position to the correct monitor node, preserving intact
   * sub-trees. Runs after a workspace-change burst has settled so the
   * "is the whole container migrating?" test reflects the final state.
   */
  _reconcileWindowHomes() {
    const windowNodes = this.tree.getNodeByType(NODE_TYPES.WINDOW);
    for (const wNode of windowNodes) {
      const metaWindow = wNode.nodeValue;
      if (!this._validWindow(metaWindow)) continue;
      const ws = metaWindow.get_workspace();
      if (!ws) continue;
      const destNode = this.tree.findNode(
        Utils.createMonitorWorkspaceId(metaWindow.get_monitor(), ws.index())
      );
      if (!destNode || destNode.contains(wNode)) continue;
      this._rehomeWindowPreservingContainer(wNode, metaWindow, destNode);
    }
  }

  /**
   * forge-6pe: True when every window beneath `node` now lives on the same
   * monitor + workspace as `metaWindow` — i.e. the whole sub-tree is migrating
   * together (as happens when GNOME shifts an entire workspace). Used to move an
   * intact container instead of flattening windows one by one.
   *
   * @param {Node} node - A container (CON or MONITOR) node to test.
   * @param {Meta.Window} metaWindow - The migrating window defining the destination.
   * @returns {boolean}
   */
  _containerFullyMigrates(node, metaWindow) {
    if (!node) return false;
    const destWs = metaWindow.get_workspace();
    if (!destWs) return false;
    const destWsIndex = destWs.index();
    const destMon = metaWindow.get_monitor();
    const windowNodes = node.getNodeByType(NODE_TYPES.WINDOW);
    if (!windowNodes || windowNodes.length === 0) return false;
    return windowNodes.every((wn) => {
      const mw = wn.nodeValue;
      const ws = mw && mw.get_workspace ? mw.get_workspace() : null;
      return ws && ws.index() === destWsIndex && mw.get_monitor() === destMon;
    });
  }

  /**
   * Handle any updates to the current focused window's position.
   * Useful for updating the active window border, etc.
   */
  updateMetaPositionSize(_metaWindow, from) {
    let focusMetaWindow = this.focusMetaWindow;
    if (!focusMetaWindow) return;

    let focusNodeWindow = this.findNodeWindow(focusMetaWindow);
    if (!focusNodeWindow) return;

    let tilingModeEnabled = this.ext.settings.get_boolean("tiling-mode-enabled");

    if (focusNodeWindow.grabMode && tilingModeEnabled) {
      if (focusNodeWindow.grabMode === GRAB_TYPES.RESIZING) {
        this._handleResizing(focusNodeWindow);
      } else if (focusNodeWindow.grabMode === GRAB_TYPES.MOVING) {
        this._handleMoving(focusNodeWindow);
      }
    } else {
      // Bug #461 (forge-9yo): GNOME's native edge-snap/maximize on a tiled window
      // leaves it desynced from its tree slot. Re-assert tiling on the *changed*
      // window (not necessarily the focused one) before the regular render gate.
      let changedNode = this.findNodeWindow(_metaWindow);
      if (this._shouldRejectExternalMaximize(changedNode, _metaWindow)) {
        Compat.unmaximize(_metaWindow);
        this.renderTree(from);
      } else if (Compat.isNotMaximized(focusMetaWindow)) {
        this.renderTree(from);
      }
    }
    this.updateBorderLayout();
    this.updateDecorationLayout();
  }

  /**
   * Bug #461: should Forge override a native maximize/edge-snap on this window?
   * True only when the changed node is a tiled, non-fullscreen window that is NOT
   * the sole tiled window on its monitor (the lone-window case is the legitimate
   * window-maximize-on-single behavior and must be left alone — see
   * handleMaximizeOnSingle, which shares _tiledWindowsOnMonitor to avoid a loop).
   * Uses getMaximizeFlags (any axis) so single-axis edge-snaps are caught too.
   */
  _shouldRejectExternalMaximize(node, metaWindow) {
    if (!node || node.mode !== WINDOW_MODES.TILE) return false;
    if (!this.ext.settings.get_boolean("tiling-mode-enabled")) return false;
    if (metaWindow.is_fullscreen && metaWindow.is_fullscreen()) return false;
    if (Compat.getMaximizeFlags(metaWindow) === 0) return false;
    let monitor = this.tree.findAncestorMonitor(node);
    return this._tiledWindowsOnMonitor(monitor).length > 1;
  }

  updateDecorationLayout() {
    if (this._freezeRender) return;
    let activeWsNode = this.currentWsNode;
    let allCons = this.tree.getNodeByType(NODE_TYPES.CON);

    // First, hide all decorations:
    allCons.forEach((con) => {
      if (con.decoration) {
        con.decoration.hide();
      }
    });

    // Next, handle showing-desktop usually by Super + D
    if (!activeWsNode) return;
    let allWindows = activeWsNode.getNodeByType(NODE_TYPES.WINDOW);
    let allHiddenWindows = allWindows.filter((w) => {
      let metaWindow = w.nodeValue;
      return !metaWindow.showing_on_its_workspace() || metaWindow.minimized;
    });

    // Then if all hidden, do not proceed showing the decorations at all;
    if (allWindows.length === allHiddenWindows.length) return;

    // Show the decoration where on all monitors of active workspace
    // But not on the monitor where there is a maximized or fullscreen window
    // Note, that when multi-display, user can have multi maximized windows,
    // So it needs to be fully filtered:
    let monWsNoMaxWindows = activeWsNode.getNodeByType(NODE_TYPES.MONITOR).filter((monitor) => {
      return (
        monitor
          .getNodeByType(NODE_TYPES.WINDOW)
          // forge-iwi: a minimized maximized/fullscreen window covers nothing, so
          // it must not keep tab/stack decorations hidden (they never returned).
          .filter(
            (w) =>
              !w.nodeValue.minimized &&
              (Compat.isMaximized(w.nodeValue) || w.nodeValue.is_fullscreen())
          ).length === 0
      );
    });

    monWsNoMaxWindows.forEach((monitorWs) => {
      let activeMonWsCons = monitorWs.getNodeByType(NODE_TYPES.CON);
      activeMonWsCons.forEach((con) => {
        let tiled = this.tree.getTiledChildren(con.childNodes);
        let showTabs = this.ext.settings.get_boolean("showtab-decoration-enabled");
        if (con.decoration && tiled.length > 0 && showTabs) {
          con.decoration.show();
          if (global.window_group.contains(con.decoration) && this.focusMetaWindow) {
            global.window_group.remove_child(con.decoration);
            // Show it below the focused window
            global.window_group.insert_child_below(
              con.decoration,
              this.focusMetaWindow.get_compositor_private()
            );
          }
          con.childNodes.forEach((cn) => {
            cn.render();
          });
        }
      });
    });
  }

  freezeRender() {
    this._freezeRender = true;
  }

  unfreezeRender() {
    this._freezeRender = false;
  }

  /**
   * Temporarily unfreeze render state, render the tree, then restore.
   * @param {string} from - Debug identifier for the render call
   */
  _renderWithFreezeState(from) {
    let prevFrozen = this._freezeRender;
    if (prevFrozen) this.unfreezeRender();
    this.renderTree(from);
    if (prevFrozen) this.freezeRender();
  }

  /**
   * forge-4yl: shared handler for the minimize/unminimize signals. Both reset
   * the focused node's parent sibling percents and re-render under the freeze
   * state. Minimize additionally hides borders and, when the parent has no
   * tiled children left, resets the grandparent's percents too.
   */
  _onMinimizeChange(reason, { hideBorders = false, resetGrandparentIfEmpty = false } = {}) {
    if (hideBorders) this.hideWindowBorders();
    let focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
    if (focusNodeWindow) {
      if (
        resetGrandparentIfEmpty &&
        this.tree.getTiledChildren(focusNodeWindow.parentNode.childNodes).length === 0
      ) {
        this.tree.resetSiblingPercent(focusNodeWindow.parentNode.parentNode);
      }
      this.tree.resetSiblingPercent(focusNodeWindow.parentNode);
    }
    this._renderWithFreezeState(reason);
  }

  floatingWindow(node) {
    if (!node) return false;
    return node.nodeType === NODE_TYPES.WINDOW && node.mode === WINDOW_MODES.FLOAT;
  }

  /**
   * Moves the pointer along with the nodeWindow's meta
   *
   * This is useful for making sure that Forge calculates the attachNode
   * properly
   */
  movePointerWith(nodeWindow, { force = false } = {}) {
    if (!nodeWindow || !nodeWindow._data) return;
    const shouldWarp = force || this.ext.settings.get_boolean("move-pointer-focus-enabled");
    if (shouldWarp) {
      this.storePointerLastPosition(this.lastFocusedWindow);
      if (this.canMovePointerInsideNodeWindow(nodeWindow)) {
        this.warpPointerToNodeWindow(nodeWindow);
      }
    }
    this.lastFocusedWindow = nodeWindow;
    this.tree.debugParentNodes(nodeWindow);
  }

  warpPointerToNodeWindow(nodeWindow) {
    const newCoord = this.getPointerPositionInside(nodeWindow);
    if (newCoord && newCoord.x && newCoord.y) {
      const seat = Clutter.get_default_backend().get_default_seat();
      if (seat) {
        const wmTitle = nodeWindow.nodeValue.get_title();
        Logger.debug(`moved pointer to [${wmTitle}] at (${newCoord.x},${newCoord.y})`);
        seat.warp_pointer(newCoord.x, newCoord.y);
      }
    }
  }

  getPointer() {
    return global.get_pointer();
  }

  minimizedWindow(node) {
    if (!node) return false;
    return node._type === NODE_TYPES.WINDOW && node._data && node._data.minimized;
  }

  swapWindowsUnderPointer(focusNodeWindow) {
    if (this.cancelGrab) {
      return;
    }
    // Bug #354 fix: Validate nodes before swap
    if (!focusNodeWindow || !focusNodeWindow.nodeValue) {
      Logger.warn("swapWindowsUnderPointer: invalid focusNodeWindow");
      return;
    }
    let nodeWinAtPointer = this.findNodeWindowAtPointer(focusNodeWindow);
    if (!nodeWinAtPointer || !nodeWinAtPointer.nodeValue) {
      return;
    }
    if (!focusNodeWindow.parentNode || !nodeWinAtPointer.parentNode) {
      Logger.warn("swapWindowsUnderPointer: missing parent node");
      return;
    }
    this.tree.swapPairs(focusNodeWindow, nodeWinAtPointer);
  }

  /**
   * Execute a drop operation, modifying the tree structure.
   *
   * @param {Object} focusNodeWindow - The window node being dragged
   * @param {Object} operation - The drop operation object from _buildDropOperation
   * @param {Object} nodeWinAtPointer - The target window node under the pointer
   * @param {Object} ctx - Context with parent info (isMonParent, isConParent, centerLayout)
   */
  _executeDropOperation(focusNodeWindow, operation, nodeWinAtPointer, ctx) {
    const { containerNode, referenceNode, isCenter, isHorizontal, isBefore } = operation;
    const { isMonParent, isConParent, centerLayout, parentNodeTarget, stackedOrTabbed } = ctx;

    const previousParent = focusNodeWindow.parentNode;
    this.tree.resetSiblingPercent(containerNode);
    this.tree.resetSiblingPercent(previousParent);

    // Bug #328 fix: Add try-catch around tab decoration removal
    if (focusNodeWindow.tab) {
      try {
        const decoParent = focusNodeWindow.tab.get_parent();
        if (decoParent) decoParent.remove_child(focusNodeWindow.tab);
      } catch (e) {
        Logger.warn(`Failed to remove tab decoration: ${e}`);
      }
    }

    if (operation.isSwap) {
      this.tree.swapPairs(referenceNode, focusNodeWindow);
      this.renderTree("drag-swap");
    } else if (operation.shouldCreateCon) {
      const numWin = parentNodeTarget.childNodes.filter(
        (c) => c.nodeType === NODE_TYPES.WINDOW
      ).length;
      const numChild = parentNodeTarget.childNodes.length;
      const sameNumChild = numWin === numChild;

      let childNode;
      // Reuse existing container if conditions are met
      if (
        !isCenter &&
        ((isConParent && numWin === 1 && sameNumChild) ||
          (isMonParent && numWin === 2 && sameNumChild))
      ) {
        childNode = parentNodeTarget;
      } else {
        childNode = new Node(NODE_TYPES.CON, new St.Bin());
        containerNode.insertBefore(childNode, referenceNode);
        childNode.appendChild(nodeWinAtPointer);
      }

      // Insert dragged window in correct position
      childNode.insertBefore(focusNodeWindow, isBefore ? nodeWinAtPointer : null);

      // Set layout based on edge direction
      if (isHorizontal) {
        childNode.layout = LAYOUT_TYPES.HSPLIT;
      } else if (!isCenter) {
        childNode.layout = LAYOUT_TYPES.VSPLIT;
      } else {
        childNode.layout = LAYOUT_TYPES[centerLayout];
      }
    } else if (operation.shouldDetachWindow) {
      const orientation = isHorizontal ? ORIENTATION_TYPES.HORIZONTAL : ORIENTATION_TYPES.VERTICAL;
      this.tree.split(focusNodeWindow, orientation);
      containerNode.insertBefore(focusNodeWindow.parentNode, referenceNode);
    } else {
      // Simple insert without creating container
      containerNode.insertBefore(focusNodeWindow, referenceNode);
      if (isHorizontal) {
        containerNode.layout = LAYOUT_TYPES.HSPLIT;
      } else if (!isCenter) {
        if (!stackedOrTabbed) containerNode.layout = LAYOUT_TYPES.VSPLIT;
      } else if (containerNode.isHSplit() || containerNode.isVSplit()) {
        containerNode.layout = LAYOUT_TYPES[centerLayout];
      }
    }

    previousParent.resetLayoutSingleChild();

    // BUG FIX: Reset flags on focusNodeWindow, not childNode
    // Previously these were set on childNode which could be a different node
    focusNodeWindow.createCon = false;
    focusNodeWindow.detachWindow = false;
  }

  /**
   * Show the drop preview hint for a drag operation.
   *
   * @param {Object} focusNodeWindow - The window node being dragged
   * @param {Object} operation - The drop operation object with previewRect and previewClass
   */
  _showDropPreview(focusNodeWindow, operation) {
    const previewHint = focusNodeWindow.previewHint;
    const previewHintEnabled = this.ext.settings.get_boolean("preview-hint-enabled");
    if (previewHint && previewHintEnabled) {
      if (!operation || !operation.previewRect) {
        previewHint.hide();
        return;
      }
      previewHint.set_style_class_name(operation.previewClass || "");
      previewHint.set_position(operation.previewRect.x, operation.previewRect.y);
      previewHint.set_size(operation.previewRect.width, operation.previewRect.height);
      previewHint.show();
    }
  }

  /**
   * Build a declarative drop operation object based on the zone and context.
   *
   * @param {string} zone - DROP_ZONES value
   * @param {Object} ctx - Context object containing:
   *   - nodeWinAtPointer: target window node
   *   - parentNodeTarget: parent container of target
   *   - horizontal: boolean, is parent horizontal layout
   *   - isMonParent: boolean, is parent a monitor node
   *   - stackedOrTabbed: boolean, is parent stacked or tabbed
   *   - centerLayout: string, center layout preference (SWAP/STACKED/TABBED)
   *   - previewRegions: regions for preview display
   *   - tree: tree reference for processGap
   * @returns {Object|null} Operation object or null if no valid operation
   */
  _buildDropOperation(zone, ctx) {
    const {
      nodeWinAtPointer,
      parentNodeTarget,
      horizontal,
      isMonParent,
      stackedOrTabbed,
      stacked,
      centerLayout,
      previewRegions,
      targetRect,
    } = ctx;

    // Precompute zone characteristics for use in operation
    const isCenter = zone === DROP_ZONES.CENTER;
    const isHorizontal = isHorizontalZone(zone);
    const isBefore = isBeforeZone(zone);

    // Handle CENTER zone
    if (isCenter) {
      const baseOp = { zone, isCenter, isHorizontal, isBefore };
      if (centerLayout === "SWAP") {
        return {
          ...baseOp,
          isSwap: true,
          referenceNode: nodeWinAtPointer,
          previewRect: targetRect,
          previewClass: this._getDragDropCenterPreviewStyle(),
        };
      }
      if (stackedOrTabbed) {
        return {
          ...baseOp,
          containerNode: parentNodeTarget,
          referenceNode: null,
          previewRect: targetRect,
          previewClass: stacked ? "window-tilepreview-stacked" : "window-tilepreview-tabbed",
        };
      }
      if (isMonParent) {
        return {
          ...baseOp,
          shouldCreateCon: true,
          containerNode: parentNodeTarget,
          referenceNode: nodeWinAtPointer,
          previewRect: targetRect,
          previewClass: this._getDragDropCenterPreviewStyle(),
        };
      }
      // CON parent
      return {
        ...baseOp,
        containerNode: parentNodeTarget,
        referenceNode: null,
        previewRect: this.tree.processGap(parentNodeTarget),
        previewClass: this._getDragDropCenterPreviewStyle(),
      };
    }

    // Edge drops share common patterns
    const baseEdgeOp = {
      zone,
      isCenter,
      isHorizontal,
      isBefore,
      previewRect: previewRegions[zone.toLowerCase()],
      previewClass: "window-tilepreview-tiled",
    };

    // Stacked/tabbed containers: detach and split
    if (stackedOrTabbed) {
      let referenceNode, containerNode;
      if (!isMonParent) {
        referenceNode = isBefore ? parentNodeTarget : parentNodeTarget.nextSibling;
        containerNode = parentNodeTarget.parentNode;
      } else {
        containerNode = parentNodeTarget;
        referenceNode = isBefore ? parentNodeTarget.firstChild : null;
      }
      return { ...baseEdgeOp, shouldDetachWindow: true, containerNode, referenceNode };
    }

    // Normal container: create con when orientation doesn't match edge direction
    return {
      ...baseEdgeOp,
      shouldCreateCon: isHorizontal !== horizontal,
      containerNode: parentNodeTarget,
      referenceNode: isBefore ? nodeWinAtPointer : nodeWinAtPointer.nextSibling,
    };
  }

  /**
   * Handle previewing and applying where a drag-drop window is going to be tiled.
   * Refactored to use helper methods for clarity and DRY principles.
   */
  moveWindowToPointer(focusNodeWindow, preview = false) {
    // Early exits
    if (this.cancelGrab) return;
    if (!focusNodeWindow || focusNodeWindow.mode !== WINDOW_MODES.GRAB_TILE) return;

    const nodeWinAtPointer = this.nodeWinAtPointer;
    if (!nodeWinAtPointer) return;

    // Bug #328 fix: Validate node structure before accessing
    if (!nodeWinAtPointer.nodeValue || !nodeWinAtPointer.parentNode) {
      Logger.warn("moveWindowToPointer: invalid nodeWinAtPointer structure");
      return;
    }

    const parentNodeTarget = nodeWinAtPointer.parentNode;
    if (!parentNodeTarget.childNodes || !Array.isArray(parentNodeTarget.childNodes)) {
      Logger.warn("moveWindowToPointer: invalid parent structure");
      return;
    }

    // Calculate regions and detect zone
    const targetRect = nodeWinAtPointer.nodeValue.get_frame_rect();
    const hoverRegions = calculateDropRegions(targetRect, 0.3);
    const zone = detectDropZone(hoverRegions, this.getDragPointer(focusNodeWindow));
    if (zone === DROP_ZONES.NONE) return;

    // Build context for operation
    const ctx = {
      nodeWinAtPointer,
      parentNodeTarget,
      horizontal: parentNodeTarget.isHSplit() || parentNodeTarget.isTabbed(),
      isMonParent: parentNodeTarget.nodeType === NODE_TYPES.MONITOR,
      isConParent: parentNodeTarget.nodeType === NODE_TYPES.CON,
      stacked: parentNodeTarget.isStacked(),
      stackedOrTabbed: parentNodeTarget.isStacked() || parentNodeTarget.isTabbed(),
      centerLayout: this.ext.settings.get_string("dnd-center-layout").toUpperCase(),
      previewRegions: calculateDropRegions(targetRect, 0.5),
      targetRect,
    };

    // Build operation
    const operation = this._buildDropOperation(zone, ctx);
    if (!operation) return;

    // Execute or preview
    if (preview) {
      this._showDropPreview(focusNodeWindow, operation);
    } else {
      this._executeDropOperation(focusNodeWindow, operation, nodeWinAtPointer, ctx);
    }
  }

  canMovePointerInsideNodeWindow(nodeWindow) {
    if (nodeWindow && nodeWindow._data) {
      const metaWindow = nodeWindow.nodeValue;
      const metaRect = metaWindow.get_frame_rect();
      const pointerCoord = global.get_pointer();
      return (
        metaRect &&
        // xdg-copy creates a 1x1 pixel window to capture mouse events.
        metaRect.width > 8 &&
        metaRect.height > 8 &&
        !Utils.rectContainsPoint(metaRect, pointerCoord) &&
        !metaWindow.minimized &&
        !Main.overview.visible &&
        !this.pointerIsOverParentDecoration(nodeWindow, pointerCoord)
      );
    }
    return false;
  }

  pointerIsOverParentDecoration(nodeWindow, pointerCoord) {
    if (pointerCoord && nodeWindow && nodeWindow.parentNode) {
      let node = nodeWindow.parentNode;
      if (node.isStackedOrTabbed()) {
        return Utils.rectContainsPoint(node.rect, pointerCoord);
      }
    }
    return false;
  }

  getPointerPositionInside(nodeWindow) {
    if (nodeWindow && nodeWindow._data) {
      const metaWindow = nodeWindow.nodeValue;
      const metaRect = metaWindow.get_frame_rect();
      // on: last position of cursor inside window
      // on: titlebar: near to app toolbars, menubar, tabs, etc...
      let [wx, wy] = nodeWindow.pointer
        ? [nodeWindow.pointer.x, nodeWindow.pointer.y]
        : [metaRect.width / 2, 8];
      let px = wx >= metaRect.width ? metaRect.width - 8 : wx;
      let py = wy >= metaRect.height ? metaRect.height - 8 : wy;
      return {
        x: metaRect.x + px,
        y: metaRect.y + py,
      };
    }
    return null;
  }

  storePointerLastPosition(nodeWindow) {
    if (nodeWindow && nodeWindow._data) {
      const metaWindow = nodeWindow.nodeValue;
      const metaRect = metaWindow.get_frame_rect();
      const pointerCoord = global.get_pointer();
      if (Utils.rectContainsPoint(metaRect, pointerCoord)) {
        let px = pointerCoord[0] - metaRect.x;
        let py = pointerCoord[1] - metaRect.y;
        if (px > 0 && py > 0) {
          nodeWindow.pointer = { x: px, y: py };
          Logger.debug(`stored pointer for [${metaWindow.get_title()}] at (${px},${py})`);
        }
      }
    }
  }

  /**
   * Bug #151: reference coordinate for drag-target resolution. On Wayland,
   * touch/stylus drags move the window while global.get_pointer() (mouse
   * only) stays parked. While the pointer has not moved since grab start,
   * derive the coordinate from the dragged window's frame, which Mutter
   * moves with the touch point. A real pointer drag is untouched.
   */
  getDragPointer(focusNodeWindow) {
    const pointerCoord = this.getPointer();
    const start = this._grabStartPointer;
    if (!start || pointerCoord[0] !== start[0] || pointerCoord[1] !== start[1]) {
      return pointerCoord;
    }
    const inside = this.getPointerPositionInside(focusNodeWindow);
    return inside ? [inside.x, inside.y, pointerCoord[2]] : pointerCoord;
  }

  findNodeWindowAtPointer(focusNodeWindow) {
    let pointerCoord = this.getDragPointer(focusNodeWindow);

    let nodeWinAtPointer = this._findNodeWindowAtPointer(focusNodeWindow.nodeValue, pointerCoord);
    return nodeWinAtPointer;
  }

  /**
   * Focus the window under the pointer and raise it.
   *
   * @returns {boolean} true if we should continue polling, false otherwise
   */
  _focusWindowUnderPointer() {
    // Break the loop if the user has disabled the feature
    // or if the window manager is disabled
    if (!this.shouldFocusOnHover || this.disabled) return false;

    // Feature #458: Skip hover-to-focus if tiling-only mode is set and tiling is disabled
    const tilingOnly = this.ext.settings.get_boolean("focus-on-hover-tiling-only");
    const tilingEnabled = this.ext.settings.get_boolean("tiling-mode-enabled");
    if (tilingOnly && !tilingEnabled) return true;

    // We don't want to focus windows when the overview is visible
    if (Main.overview.visible) return true;

    // Bug #374 fix: Skip focus-on-hover during workspace transitions
    if (this._workspaceChanging) return true;

    // Don't steal focus from modal dialogs or password prompts (#483)
    const focusedWindow = global.display.focus_window;
    if (focusedWindow) {
      const focusedType = focusedWindow.get_window_type();
      if (focusedType === Meta.WindowType.MODAL_DIALOG || focusedType === Meta.WindowType.DIALOG) {
        // A modal/dialog has focus - don't steal it
        return true;
      }
    }

    // Get the global mouse position
    let pointer = global.get_pointer();

    const metaWindow = this._getMetaWindowAtPointer(pointer);

    if (metaWindow) {
      // If window is not null, focus it
      metaWindow.focus(global.get_current_time());
      // Raise it to the top
      metaWindow.raise();
    }

    // Continue polling
    return true;
  }

  /**
   * Get the Meta.Window at the pointer coordinates
   *
   * @param {[number, number]} pointer x and y coordinates
   * @returns null if no window is found, otherwise the Meta.Window
   */
  _getMetaWindowAtPointer(pointer) {
    const windows = global.get_window_actors();
    const [x, y] = pointer;

    // Iterate through the windows in reverse order to get the top-most window
    for (let i = windows.length - 1; i >= 0; i--) {
      let window = windows[i];
      let metaWindow = window.meta_window;

      // Feature #396: Skip notification windows and other non-focusable types
      const windowType = metaWindow.get_window_type();
      if (
        windowType === Meta.WindowType.NOTIFICATION ||
        windowType === Meta.WindowType.POPUP_MENU ||
        windowType === Meta.WindowType.DROPDOWN_MENU
      ) {
        continue;
      }

      let { x: wx, y: wy, width, height } = metaWindow.get_frame_rect();

      // Check if the position is within the window bounds
      if (x >= wx && x <= wx + width && y >= wy && y <= wy + height) {
        return metaWindow;
      }
    }

    // No window found at the pointer
    return null;
  }

  /**
   * Finds the NodeWindow under the Meta.Window and the
   * current pointer coordinates;
   */
  _findNodeWindowAtPointer(metaWindow, pointer) {
    if (!metaWindow) return undefined;

    let sortedWindows = this.sortedWindows;

    if (!sortedWindows) {
      Logger.warn("No sorted windows");
      return;
    }

    for (let i = 0, n = sortedWindows.length; i < n; i++) {
      const w = sortedWindows[i];
      const metaRect = w.get_frame_rect();
      const atPointer = Utils.rectContainsPoint(metaRect, pointer);
      if (atPointer) return this.tree.getNodeByValue(w);
    }

    return null;
  }

  _handleGrabOpBegin(_display, _metaWindow, grabOp) {
    this.grabOp = grabOp;
    this.trackCurrentMonWs();
    // Bug #151: snapshot the pointer so getDragPointer() can tell a real
    // pointer drag (pointer moves) from a touch/stylus drag (pointer parked).
    this._grabStartPointer = this.getPointer();
    let focusMetaWindow = this.focusMetaWindow;

    if (focusMetaWindow) {
      let focusNodeWindow = this.findNodeWindow(focusMetaWindow);
      if (!focusNodeWindow) return;

      const frameRect = focusMetaWindow.get_frame_rect();
      const gaps = this.calculateGaps(focusNodeWindow);

      focusNodeWindow.grabMode = Utils.grabMode(grabOp);
      if (
        focusNodeWindow.grabMode === GRAB_TYPES.MOVING &&
        focusNodeWindow.mode === WINDOW_MODES.TILE
      ) {
        this.freezeRender();
        focusNodeWindow.mode = WINDOW_MODES.GRAB_TILE;
      }

      focusNodeWindow.initGrabOp = grabOp;
      // Only set initRect if not already tracking a resize (preserves original during key repeat)
      if (!focusNodeWindow.initRect) {
        focusNodeWindow.initRect = Utils.removeGapOnRect(frameRect, gaps);
      }

      // Bug #497 (forge-pak): snapshot the enclosing tabbed/stacked container's
      // start slice so a tab resize maps onto the container consistently while
      // the tree re-renders mid-drag.
      let tabbedAncestor = focusNodeWindow.parentNode;
      while (tabbedAncestor && tabbedAncestor.isStackedOrTabbed()) {
        if (!tabbedAncestor.initRect) tabbedAncestor.initRect = { ...tabbedAncestor.rect };
        tabbedAncestor = tabbedAncestor.parentNode;
      }

      // Bug #433 fix: Track the window being dragged for preview hint cleanup
      this._draggedNodeWindow = focusNodeWindow;
    }
  }

  _handleGrabOpEnd(_display, _metaWindow, grabOp) {
    this.unfreezeRender();
    let focusMetaWindow = this.focusMetaWindow;
    if (!focusMetaWindow) {
      // Focus lost mid-drag (window closed, monitor crossing): still release the
      // dragged window's preview hint so the overlay isn't orphaned on screen.
      if (this._draggedNodeWindow) {
        this._grabCleanup(this._draggedNodeWindow);
        this._draggedNodeWindow = null;
      }
      return;
    }
    let focusNodeWindow = this.findNodeWindow(focusMetaWindow);

    if (focusNodeWindow && !this.cancelGrab) {
      // WINDOW_BASE is when grabbing the window decoration
      // COMPOSITOR is when something like Overview requesting a grab, especially when Super is pressed.
      if (
        grabOp === Meta.GrabOp.WINDOW_BASE ||
        grabOp === Meta.GrabOp.COMPOSITOR ||
        grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED
      ) {
        if (this.allowDragDropTile()) {
          this.moveWindowToPointer(focusNodeWindow);
        }
      }
    }

    // Bug #433 fix: Clean up preview hint from the originally dragged window
    // This handles cases where focus changed during drag (e.g., crossing monitors)
    if (this._draggedNodeWindow && this._draggedNodeWindow !== focusNodeWindow) {
      this._grabCleanup(this._draggedNodeWindow);
    }
    this._draggedNodeWindow = null;

    this._grabCleanup(focusNodeWindow);

    if (Compat.isNotMaximized(focusMetaWindow)) {
      this.renderTree("grab-op-end");
    }

    this.updateStackedFocus(focusNodeWindow);
    this.updateTabbedFocus(focusNodeWindow);
    this.nodeWinAtPointer = null;
  }

  _grabCleanup(focusNodeWindow) {
    this.cancelGrab = false;
    if (!focusNodeWindow) return;
    focusNodeWindow.initRect = null;
    focusNodeWindow.grabMode = null;
    focusNodeWindow.initGrabOp = null;

    // Bug #497 (forge-pak): release any tabbed/stacked container snapshots too.
    let tabbedAncestor = focusNodeWindow.parentNode;
    while (tabbedAncestor && tabbedAncestor.isStackedOrTabbed()) {
      tabbedAncestor.initRect = null;
      tabbedAncestor = tabbedAncestor.parentNode;
    }

    // Bug #175 fix: Ensure preview hint is always cleaned up (add try-catch)
    if (focusNodeWindow.previewHint) {
      try {
        focusNodeWindow.previewHint.hide();
        if (global.window_group && global.window_group.contains(focusNodeWindow.previewHint)) {
          global.window_group.remove_child(focusNodeWindow.previewHint);
        }
        focusNodeWindow.previewHint.destroy();
      } catch (e) {
        Logger.warn(`Failed to cleanup preview hint: ${e}`);
      } finally {
        focusNodeWindow.previewHint = null;
      }
    }

    if (focusNodeWindow.mode === WINDOW_MODES.GRAB_TILE) {
      focusNodeWindow.mode = WINDOW_MODES.TILE;
    }
  }

  allowDragDropTile() {
    return this.kbd.allowDragDropTile();
  }

  /**
   * forge-pak (#497): resize a tabbed/stacked container against its split
   * sibling. The grabbed tab's frame delta drives the change, applied to the
   * container's start slice (snapshotted at grab begin, with a fallback to the
   * current slice) so it persists on re-render instead of mutating an
   * overlapping tab's percent.
   */
  _resizeContainerAgainstSibling(container, grabbedWindow, currentRect, orientation, direction) {
    const parent = container.parentNode;
    if (!parent) return;
    const pair = this.tree.nextVisible(container, direction);
    if (!pair || pair.parentNode !== parent) return;
    if (this.tree.getTiledChildren(parent.childNodes).length <= 1) return;

    const startRect = container.initRect || container.rect;
    const pairRect = pair.rect;
    const parentRect = parent.rect;
    const startWin = grabbedWindow.initRect;
    if (!startRect || !pairRect || !parentRect || !startWin) return;

    if (orientation === ORIENTATION_TYPES.HORIZONTAL) {
      const changePx = currentRect.width - startWin.width;
      container.percent = (startRect.width + changePx) / parentRect.width;
      pair.percent = (pairRect.width - changePx) / parentRect.width;
    } else if (orientation === ORIENTATION_TYPES.VERTICAL) {
      const changePx = currentRect.height - startWin.height;
      container.percent = (startRect.height + changePx) / parentRect.height;
      pair.percent = (pairRect.height - changePx) / parentRect.height;
    } else {
      return;
    }
    this._normalizeSiblingPercents(parent);
  }

  _handleResizing(focusNodeWindow) {
    if (!focusNodeWindow || focusNodeWindow.isFloat()) return;
    let grabOps = Utils.decomposeGrabOp(this.grabOp);
    for (let grabOp of grabOps) {
      let initGrabOp = focusNodeWindow.initGrabOp;
      let direction = Utils.directionFromGrab(grabOp);
      let orientation = Utils.orientationFromGrab(grabOp);
      let parentNodeForFocus = focusNodeWindow.parentNode;
      let position = Utils.positionFromGrabOp(grabOp);
      // normalize the rect without gaps
      let frameRect = this.focusMetaWindow.get_frame_rect();
      let gaps = this.calculateGaps(focusNodeWindow);
      let currentRect = Utils.removeGapOnRect(frameRect, gaps);
      let firstRect;
      let secondRect;
      let parentRect;
      let resizePairForWindow;

      if (initGrabOp === Meta.GrabOp.RESIZING_UNKNOWN) {
        // the direction is null so do not process yet below.
        return;
      }

      // Bug #497 (forge-pak): a window inside a tabbed/stacked container shares
      // the container's rect, so a sibling tab is never a meaningful resize pair
      // (its percent is ignored on render). Resize the enclosing container
      // against ITS split sibling instead; the grabbed tab's frame delta equals
      // the container's.
      let tabbedContainer = focusNodeWindow;
      while (tabbedContainer.parentNode && tabbedContainer.parentNode.isStackedOrTabbed()) {
        tabbedContainer = tabbedContainer.parentNode;
      }
      if (tabbedContainer !== focusNodeWindow) {
        this._resizeContainerAgainstSibling(
          tabbedContainer,
          focusNodeWindow,
          currentRect,
          orientation,
          direction
        );
        continue;
      }

      resizePairForWindow = this.tree.nextVisible(focusNodeWindow, direction);

      let sameParent = resizePairForWindow
        ? resizePairForWindow.parentNode === focusNodeWindow.parentNode
        : false;

      if (orientation === ORIENTATION_TYPES.HORIZONTAL) {
        if (sameParent) {
          // use the window or con pairs
          if (this.tree.getTiledChildren(parentNodeForFocus.childNodes).length <= 1) {
            return;
          }

          firstRect = focusNodeWindow.initRect;
          if (resizePairForWindow) {
            // Find a valid (non-floating, non-minimized) resize pair
            let candidatePair = resizePairForWindow;
            while (
              candidatePair &&
              (this.floatingWindow(candidatePair) || this.minimizedWindow(candidatePair))
            ) {
              candidatePair = this.tree.nextVisible(candidatePair, direction);
            }
            if (
              candidatePair &&
              !this.floatingWindow(candidatePair) &&
              !this.minimizedWindow(candidatePair)
            ) {
              resizePairForWindow = candidatePair;
              secondRect = resizePairForWindow.rect;
            }
          }

          if (!firstRect || !secondRect) {
            return;
          }

          parentRect = parentNodeForFocus.rect;
          let changePx = currentRect.width - firstRect.width;
          let firstPercent = (firstRect.width + changePx) / parentRect.width;
          let secondPercent = (secondRect.width - changePx) / parentRect.width;
          focusNodeWindow.percent = firstPercent;
          resizePairForWindow.percent = secondPercent;
          // Bug #305 fix: Normalize to prevent drift
          this._normalizeSiblingPercents(parentNodeForFocus);
        } else {
          // use the parent pairs (con to another con or window)
          if (resizePairForWindow && resizePairForWindow.parentNode) {
            if (this.tree.getTiledChildren(resizePairForWindow.parentNode.childNodes).length <= 1) {
              return;
            }
            let firstWindowRect = focusNodeWindow.initRect;
            let index = resizePairForWindow.index;
            if (position === POSITION.BEFORE) {
              // Find the opposite node
              index = index + 1;
            } else {
              index = index - 1;
            }
            parentNodeForFocus = resizePairForWindow.parentNode.childNodes[index];
            firstRect = parentNodeForFocus.rect;
            secondRect = resizePairForWindow.rect;
            if (!firstRect || !secondRect) {
              return;
            }

            parentRect = parentNodeForFocus.parentNode.rect;
            let changePx = currentRect.width - firstWindowRect.width;
            let firstPercent = (firstRect.width + changePx) / parentRect.width;
            let secondPercent = (secondRect.width - changePx) / parentRect.width;
            parentNodeForFocus.percent = firstPercent;
            resizePairForWindow.percent = secondPercent;
            // Bug #305 fix: Normalize to prevent drift
            this._normalizeSiblingPercents(parentNodeForFocus.parentNode);
          }
        }
      } else if (orientation === ORIENTATION_TYPES.VERTICAL) {
        if (sameParent) {
          // use the window or con pairs
          if (this.tree.getTiledChildren(parentNodeForFocus.childNodes).length <= 1) {
            return;
          }
          firstRect = focusNodeWindow.initRect;
          if (resizePairForWindow) {
            // Find a valid (non-floating, non-minimized) resize pair
            let candidatePair = resizePairForWindow;
            while (
              candidatePair &&
              (this.floatingWindow(candidatePair) || this.minimizedWindow(candidatePair))
            ) {
              candidatePair = this.tree.nextVisible(candidatePair, direction);
            }
            if (
              candidatePair &&
              !this.floatingWindow(candidatePair) &&
              !this.minimizedWindow(candidatePair)
            ) {
              resizePairForWindow = candidatePair;
              secondRect = resizePairForWindow.rect;
            }
          }
          if (!firstRect || !secondRect) {
            return;
          }
          parentRect = parentNodeForFocus.rect;
          let changePx = currentRect.height - firstRect.height;
          let firstPercent = (firstRect.height + changePx) / parentRect.height;
          let secondPercent = (secondRect.height - changePx) / parentRect.height;
          focusNodeWindow.percent = firstPercent;
          resizePairForWindow.percent = secondPercent;
          // Bug #305 fix: Normalize to prevent drift
          this._normalizeSiblingPercents(parentNodeForFocus);
        } else {
          // use the parent pairs (con to another con or window)
          if (resizePairForWindow && resizePairForWindow.parentNode) {
            if (this.tree.getTiledChildren(resizePairForWindow.parentNode.childNodes).length <= 1) {
              return;
            }
            let firstWindowRect = focusNodeWindow.initRect;
            let index = resizePairForWindow.index;
            if (position === POSITION.BEFORE) {
              // Find the opposite node
              index = index + 1;
            } else {
              index = index - 1;
            }
            parentNodeForFocus = resizePairForWindow.parentNode.childNodes[index];
            firstRect = parentNodeForFocus.rect;
            secondRect = resizePairForWindow.rect;
            if (!firstRect || !secondRect) {
              return;
            }

            parentRect = parentNodeForFocus.parentNode.rect;
            let changePx = currentRect.height - firstWindowRect.height;
            let firstPercent = (firstRect.height + changePx) / parentRect.height;
            let secondPercent = (secondRect.height - changePx) / parentRect.height;
            parentNodeForFocus.percent = firstPercent;
            resizePairForWindow.percent = secondPercent;
            // Bug #305 fix: Normalize to prevent drift
            this._normalizeSiblingPercents(parentNodeForFocus.parentNode);
          }
        }
      }
    }
    // Reposition focused window to prevent "traveling" during resize
    this._repositionDuringResize(focusNodeWindow);
  }

  /**
   * Repositions the focused window during resize to prevent "traveling".
   * Uses initRect as reference to calculate correct position based on which
   * edge is being dragged.
   */
  _repositionDuringResize(focusNodeWindow) {
    if (!focusNodeWindow || !focusNodeWindow.initRect) return;

    const metaWindow = focusNodeWindow.nodeValue;
    if (!metaWindow) return;

    const frameRect = metaWindow.get_frame_rect();
    const initRect = focusNodeWindow.initRect;
    const gaps = this.calculateGaps(focusNodeWindow);

    let grabOps = Utils.decomposeGrabOp(this.grabOp);
    let targetX = frameRect.x;
    let targetY = frameRect.y;

    for (const grabOp of grabOps) {
      const position = Utils.positionFromGrabOp(grabOp);
      const orientation = Utils.orientationFromGrab(grabOp);

      if (orientation === ORIENTATION_TYPES.HORIZONTAL) {
        if (position === POSITION.AFTER) {
          // Resizing right edge - x should stay fixed at initRect.x + gaps
          targetX = initRect.x + gaps;
        } else if (position === POSITION.BEFORE) {
          // Resizing left edge - x should adjust based on width change
          // initRect.x is without gaps, so add gaps for actual position
          targetX = initRect.x + gaps - (frameRect.width - (initRect.width - gaps * 2));
        }
      } else if (orientation === ORIENTATION_TYPES.VERTICAL) {
        if (position === POSITION.AFTER) {
          // Resizing bottom edge - y should stay fixed at initRect.y + gaps
          targetY = initRect.y + gaps;
        } else if (position === POSITION.BEFORE) {
          // Resizing top edge - y should adjust based on height change
          targetY = initRect.y + gaps - (frameRect.height - (initRect.height - gaps * 2));
        }
      }
    }

    // Only reposition if position actually differs
    if (targetX !== frameRect.x || targetY !== frameRect.y) {
      metaWindow.move_frame(true, targetX, targetY);
    }
  }

  _handleMoving(focusNodeWindow) {
    if (!focusNodeWindow || focusNodeWindow.mode !== WINDOW_MODES.GRAB_TILE) return;

    const nodeWinAtPointer = this.findNodeWindowAtPointer(focusNodeWindow);
    this.nodeWinAtPointer = nodeWinAtPointer;

    const hidePreview = () => {
      if (focusNodeWindow.previewHint) {
        focusNodeWindow.previewHint.hide();
      }
    };

    if (nodeWinAtPointer) {
      if (!focusNodeWindow.previewHint) {
        let previewHint = new St.Bin();
        global.window_group.add_child(previewHint);
        focusNodeWindow.previewHint = previewHint;
      }

      if (this.allowDragDropTile()) {
        this.moveWindowToPointer(focusNodeWindow, true);
      } else {
        hidePreview();
      }
    } else {
      hidePreview();
    }
  }

  /**
   * Whether a window's WM class matches an override's wmClass value. The override may
   * list several classes comma-separated; each is compared for exact equality.
   */
  _wmClassMatches(overrideWmClass, windowWmClass) {
    if (!overrideWmClass || !windowWmClass) return false;
    return overrideWmClass.split(",").some((c) => c.trim() === windowWmClass);
  }

  isFloatingExempt(metaWindow) {
    if (!metaWindow) return true;
    let windowTitle = metaWindow.get_title();
    let windowType = metaWindow.get_window_type();

    // Bug #294 fix: Check for explicit TILE override first (user preference takes precedence)
    const wmClass = metaWindow.get_wm_class();
    const wmId = metaWindow.get_id();
    const allOverrides = this.windowProps.overrides;

    // Check if user explicitly set this window to TILE
    const hasTileOverride =
      allOverrides.filter((override) => {
        if (override.mode !== "tile") return false;

        let matchTitle = true;
        let matchClass = true;
        let matchId = true;

        if (override.wmTitle) {
          matchTitle = windowTitle && windowTitle.includes(override.wmTitle);
        }
        if (override.wmClass) {
          matchClass = this._wmClassMatches(override.wmClass, wmClass);
        }
        if (override.wmId) {
          matchId = override.wmId === wmId;
        }

        return matchTitle && matchClass && matchId;
      }).length > 0;

    // If user explicitly wants it tiled, respect that (fixes Neovide, Blackbox, etc.)
    if (hasTileOverride) return false;

    // App-specific float rules (Steam #271, Blender #260, Firefox PIP #383) live in
    // config/windows.json — the canonical override mechanism — rather than hardcoded here,
    // so they stay user-editable and don't contradict the config (forge-khb).

    let floatByType =
      windowType === Meta.WindowType.DIALOG ||
      windowType === Meta.WindowType.MODAL_DIALOG ||
      metaWindow.get_transient_for() !== null ||
      metaWindow.get_wm_class() === null ||
      windowTitle === null ||
      windowTitle === "" ||
      windowTitle.length === 0 ||
      // Bug #469 (forge-w7e): a window the user pins "Always on Top" is a
      // Z-axis overlay; float it out of the tile grid (Forge only pins windows
      // it already floats, so tiled windows are unaffected until the user acts).
      metaWindow.is_above() ||
      !metaWindow.allows_resize();

    const knownFloats = this.windowProps.overrides.filter((wprop) => wprop.mode === "float");

    let floatOverride =
      knownFloats.filter((kf) => {
        let matchTitle = false;
        let matchClass = false;
        let matchId = false;

        if (kf.wmTitle) {
          if (kf.wmTitle === " ") {
            matchTitle = kf.wmTitle === windowTitle;
          } else {
            let titles = kf.wmTitle.split(",");
            matchTitle =
              titles.filter((t) => {
                if (windowTitle) {
                  if (t.startsWith("!")) {
                    return !windowTitle.includes(t.slice(1));
                  } else {
                    return windowTitle.includes(t);
                  }
                }
                return false;
              }).length > 0;
          }
        }
        if (kf.wmClass) {
          matchClass = this._wmClassMatches(kf.wmClass, metaWindow.get_wm_class());
        }
        if (kf.wmId) {
          matchId = kf.wmId === metaWindow.get_id();
        }

        // Bug #172 fix: If override has wmId (per-window), REQUIRE it to match
        // If no wmId (class-based), match all windows of that class
        if (kf.wmId) {
          return matchId && matchClass;
        }
        return (!kf.wmTitle || matchTitle) && matchClass;
      }).length > 0;

    return floatByType || floatOverride;
  }

  _getDragDropCenterPreviewStyle() {
    const centerLayout = this.ext.settings.get_string("dnd-center-layout");
    return `window-tilepreview-${centerLayout}`;
  }

  get currentMonWsNode() {
    const monWs = this.currentMonWs;
    if (monWs) {
      return this.tree.findNode(monWs);
    }
    return null;
  }

  get currentWsNode() {
    const ws = this.currentWs;
    if (ws) {
      return this.tree.findNode(ws);
    }
    return null;
  }

  get currentMonWs() {
    const monWs = `${this.currentMon}${this.currentWs}`;
    return monWs;
  }

  get currentWs() {
    const display = global.display;
    const wsMgr = display.get_workspace_manager();
    return `ws${wsMgr.get_active_workspace_index()}`;
  }

  get currentMon() {
    const display = global.display;
    return `mo${display.get_current_monitor()}`;
  }

  /**
   * Reload window overrides from the configuration file
   * This is called when the preferences page modifies the overrides
   */
  reloadWindowOverrides() {
    // Get fresh data from the ConfigManager
    const freshProps = this.ext.configMgr.windowProps;
    if (freshProps) {
      this.windowProps = freshProps;
      this.windowProps.overrides = this.windowProps.overrides.filter((override) => !override.wmId);
      Logger.info(`Reloaded ${this.windowProps.overrides.length} window overrides from file`);
    }
  }

  floatAllWindows() {
    this.tree.getNodeByType(NODE_TYPES.WINDOW).forEach((w) => {
      if (w.isFloat()) {
        w.prevFloat = true;
      }
      w.mode = WINDOW_MODES.FLOAT;
    });
  }

  unfloatAllWindows() {
    this.tree.getNodeByType(NODE_TYPES.WINDOW).forEach((w) => {
      if (!w.prevFloat) {
        w.mode = WINDOW_MODES.TILE;
      } else {
        // Reset the float marker
        w.prevFloat = false;
      }
    });
  }
}
