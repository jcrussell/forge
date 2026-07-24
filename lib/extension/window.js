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
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import St from "gi://St";

// Gnome Shell imports
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

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
import { DecorationManager } from "./decoration.js";
import { FocusManager } from "./focus.js";
import * as Compat from "./compat.js";

/** @typedef {import('../../extension.js').default} ForgeExtension */

export const WINDOW_MODES = createEnum(["FLOAT", "TILE", "GRAB_TILE", "DEFAULT"]);

// Simplify the grab modes
export const GRAB_TYPES = createEnum(["RESIZING", "MOVING", "UNKNOWN"]);

// forge-zlg: golden-ratio reciprocal (1/φ). The focused window claims this share
// of its split pair; the pair gets the remainder (1 - GOLDEN).
const GOLDEN = 0.6180339887;

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
      !production ? "DEV" : ext.metadata["version-name"] ?? "unknown"
    }`;
    this.reloadWindowOverrides();
    this._tree = new Tree(this);
    // Owns decoration/border rendering. Decoration methods are signal/render-driven
    // (never invoked during this constructor), so building it here is safe.
    this.decorationManager = new DecorationManager(this._tree, this);
    // Owns the focus/pointer-follow cluster. Constructed BEFORE the pointerLoopInit()
    // call below (which delegates to it when focus-on-hover is enabled), so it must
    // exist by then.
    this.focusManager = new FocusManager(this._tree, this);
    this.eventQueue = new Queue();
    this.theme = this.ext.theme;
    this.lastFocusedWindow = null;
    this.shouldFocusOnHover = this.ext.settings.get_boolean("focus-on-hover-enabled");

    this._commandHandler = new CommandHandler(this);

    Logger.info("forge initialized");

    if (this.shouldFocusOnHover) {
      // Start the pointer loop to observe the pointer position
      // and change the focus window accordingly
      this.pointerLoopInit();
    }
  }

  pointerLoopInit() {
    return this.focusManager.pointerLoopInit();
  }

  /**
   * Load window overrides, apply an update function, then save.
   * @param {Function} updateFn - Receives (overrides, wmClass, wmId), returns updated overrides
   * @param {Meta.Window} metaWindow
   * @param {boolean} withWmId
   */
  _updateWindowOverrides(updateFn, metaWindow, withWmId) {
    // windowDestroy runs the remove path on EVERY close, and a fast/Wayland close
    // can finalize the wrapper before this runs — get_wm_class()/get_id() would
    // throw "already deallocated" and abort the rest of windowDestroy (forge-h7ba).
    if (!Utils.isWindowAlive(metaWindow)) return;
    let currentProps = this.ext.configMgr.windowProps;
    let wmClass = metaWindow.get_wm_class();
    let wmId = metaWindow.get_id();
    const beforeLength = currentProps.overrides.length;
    currentProps.overrides = updateFn(currentProps.overrides, wmClass, wmId, withWmId);
    // ALWAYS refresh the WM cache from this fresh config read: other writers
    // (prefs, the e2e bridge) update configMgr without touching this.windowProps,
    // and isFloatingExempt reads the cache — keeping a stale one misroutes the
    // next float toggle (caught on the F39 lane).
    this.windowProps = currentProps;
    // Both updateFns only add or remove entries; skip the DISK write when the
    // set is unchanged — windowDestroy runs the remove path on EVERY close.
    if (currentProps.overrides.length === beforeLength) return;
    this.ext.configMgr.windowProps = currentProps;
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
      shellWm.connect("minimize", (_shellwm, actor) =>
        this._onMinimizeChange("minimize", {
          hideBorders: true,
          resetGrandparentIfEmpty: true,
          metaWindow: actor?.meta_window,
        })
      ),
      shellWm.connect("unminimize", (_shellwm, actor) =>
        this._onMinimizeChange("unminimize", { metaWindow: actor?.meta_window })
      ),
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
        // forge-ojew: re-home surviving windows off the doomed workspace BEFORE
        // removeChild splices the subtree out, otherwise they are stranded.
        this._rehomeWorkspaceWindowsBeforeRemoval(wsIndex);
        this.tree.removeWorkspace(wsIndex);
        this.tree.workspaceManager.renumberWorkspacesAfterRemoval(wsIndex);
        this.trackCurrentMonWs();
        this.workspaceRemoved = true;
        this.updateDecorationLayout();
        this.renderTree("workspace-removed");
      }),
      // forge-2s5b: reorder_workspace() renumbers workspace indices WITHOUT
      // emitting workspace-added/removed or per-window workspace-changed, so the
      // tree's index-keyed nodes (ws{n}, mo{m}ws{n}) go stale and point at the
      // wrong Meta workspaces. The reorder signal carries no permutation args, so
      // a targeted rekey would need identity tracking; instead reload the tree,
      // which rebuilds the index-keyed scaffold from live workspace indices and
      // re-homes every window by its current workspace. Reorders are rare, so the
      // reload cost is acceptable (same recovery path as the no-meta-monws case).
      globalWsm.connect("workspaces-reordered", () => {
        // forge-gw2c: a reorder permutes index<->object with no add/remove signal,
        // leaving the index-keyed signal map stale (bindWorkspaceSignals then
        // early-returns for every index, so reload alone never rebinds it). Tear the
        // map down first — object-anchored disconnect makes this reliable — then the
        // reload rebinds each workspace against its current index.
        this.tree.workspaceManager.destroy();
        this.reloadTree("workspaces-reordered");
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
      settings.connect("changed", (_, settingName) => this._onSettingsChanged(settingName))
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
    // Consume the flags unconditionally: a workspace change on an EMPTY tree
    // must not leave them set, or the next unrelated workareas-changed (dock
    // autohide, strut change) takes the expensive re-track branch instead of
    // a plain re-render.
    const needsRetrack = this.workspaceAdded || this.workspaceRemoved;
    this.workspaceAdded = false;
    this.workspaceRemoved = false;
    if (this.tree.getNodeByType("WINDOW").length > 0) {
      if (needsRetrack) {
        this.trackCurrentWindows();
      } else {
        this.renderTree("workareas-changed");
      }
    }
  }

  /**
   * Iterate the live FLOAT windows in the tree. Centralizes the mode filter and
   * the Utils.isWindowAlive() probe (forge-h7ba) so the always-on-top pin/unpin
   * paths can't throw on a finalized Meta.Window wrapper mid-forEach and leave
   * the remaining floats mis-pinned.
   */
  _forEachFloatNode(fn) {
    this.allNodeWindows.forEach((w) => {
      if (w.mode !== WINDOW_MODES.FLOAT) return;
      const metaWindow = w.nodeValue;
      if (!Utils.isWindowAlive(metaWindow)) return;
      fn(metaWindow, w);
    });
  }

  cleanupAlwaysFloat() {
    // Always-on-top was turned off: unpin every float, dialogs included. Dialogs
    // are kept above the tiled grid by raise-on-focus, not a global pin, so a
    // dialog exception here would only strand a popup above other floats.
    this._forEachFloatNode((metaWindow) => {
      metaWindow.is_above() && metaWindow.unmake_above();
    });
  }

  restoreAlwaysFloat() {
    this._forEachFloatNode((metaWindow) => {
      !metaWindow.is_above() && metaWindow.make_above();
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
      // forge-olv3: windowDestroy calls this synchronously pre-prune, so a
      // finalized wrapper's is_fullscreen() would throw and abort the destroy.
      if (!Utils.isWindowAlive(metaWindow) || !metaWindow.is_fullscreen()) return;
      if (this._isDialogLike(metaWindow)) return;
      const monIdx = this._monitorIndexOfNode(w);
      fullscreenCounts.set(monIdx, (fullscreenCounts.get(monIdx) || 0) + 1);
    });

    this._withSuppressedAboveHandler(() => {
      nodes.forEach((w) => {
        if (w.mode !== WINDOW_MODES.FLOAT) return;
        const metaWindow = w.nodeValue;
        // forge-olv3: skip finalized wrappers (is_above/is_fullscreen would throw
        // out of the synchronous windowDestroy path), mirroring _forEachFloatNode.
        if (!Utils.isWindowAlive(metaWindow)) return;
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
            // forge-0qx7: runs from raw signal handlers before pruneDeadWindows,
            // so a finalized wrapper's .minimized would throw and abort tracking.
            Utils.isWindowAlive(w.nodeValue) &&
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

    // forge-h6z9: the debounced grab-end is a single instance-wide timer. If a
    // pending end belongs to a DIFFERENT window than the one now focused (focus
    // drifted between two keyboard resizes), flush that window's grab first so
    // its node isn't left with grabMode/initRect stranded forever. The end-fire
    // path reads this.focusMetaWindow, so clean the prior node directly here.
    if (this._manualResizeEndId && this._manualResizeEndWindow !== metaWindow) {
      this._clearTimeoutId("_manualResizeEndId");
      const priorNode = this.findNodeWindow(this._manualResizeEndWindow);
      if (priorNode) {
        this.unfreezeRender();
        this._grabCleanup(priorNode);
      }
      this._manualResizeEndWindow = null;
    }

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
        // forge-74em: N/UP grows the TOP edge, so shift y up (mirror of LEFT).
        rect.height = rect.height + amount;
        rect.y = rect.y - amount;
        break;
      case Meta.MotionDirection.DOWN:
        // S/DOWN grows the BOTTOM edge, so y stays put (mirror of RIGHT).
        rect.height = rect.height + amount;
        break;
    }
    this.move(metaWindow, rect, null, { skipOffscreenClamp: true });

    // Bug #532 (forge-5v6): on key auto-repeat each press calls resize() again.
    // Restart a single debounced grab-end instead of queueing one per press, so
    // the grab (and its frozen initRect) stays open for the whole hold and the
    // resize accumulates smoothly; the layout settles once the key is released.
    if (this._manualResizeEndId) {
      GLib.source_remove(this._manualResizeEndId);
    }
    // forge-h6z9: remember which window the pending end belongs to so a later
    // cross-window resize can flush it (above), and a real pointer grab
    // beginning within the debounce can cancel it (see _handleGrabOpBegin).
    this._manualResizeEndWindow = metaWindow;
    this._manualResizeEndId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
      this._manualResizeEndId = 0;
      this._manualResizeEndWindow = null;
      this._handleGrabOpEnd(display, metaWindow, grabOp);
      return false;
    });
  }

  /**
   * forge-gm0z: grow (or, with a negative amount, shrink) the focused tiled
   * window on BOTH axes.
   *
   * This replaces the old WindowExpand/WindowShrink path that fired four
   * overlapping wm.resize() grabs (N, S, W, E). Those calls all wrote the single
   * shared this.grabOp, and _handleResizing is async/signal-driven, so by the
   * time the signals fired only the last op (RESIZING_E) survived — the window
   * never grew vertically, and a rightmost-column window with no right sibling
   * did not grow at all.
   *
   * The grab machinery is bypassed entirely: percents are adjusted directly
   * against the focused node's split pair in its parent (one axis) and, when
   * nested, against the enclosing container's split pair in the grandparent (the
   * other axis), then the tree is re-rendered. This is the two-axis behavior the
   * 4-call burst INTENDED.
   *
   * @param {number} amount - pixels to grow each affected edge by (negative shrinks).
   */
  expand(amount) {
    if (!amount) return;
    let focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (!focusNodeWindow || !focusNodeWindow.isTile()) return;

    // Grow the focused window in its own split (one orientation), and the
    // enclosing container in the grandparent split (the other orientation), so
    // the window claims space on both axes like the original 4-call burst meant.
    let changed = this._expandNodeAgainstPair(focusNodeWindow, amount);
    let container = focusNodeWindow.parentNode;
    if (container && container.isCon()) {
      changed = this._expandNodeAgainstPair(container, amount) || changed;
    }

    if (changed) this.renderTree("window-expand");
  }

  /** forge-gm0z: WindowShrink is WindowExpand with a negative amount. */
  shrink(amount) {
    this.expand(-amount);
  }

  /**
   * forge-gm0z: grow `node` by `deltaPx` against its split pair within its
   * parent, debiting the pair, then normalize — mirroring the sameParent branch
   * of _handleResizing (window.js:3158+) so manual resize and expand/shrink stay
   * consistent. The split pair is the next tiled sibling, or the previous one
   * when `node` is the last child. Returns true when a percent was changed.
   */
  _expandNodeAgainstPair(node, deltaPx) {
    const parent = node.parentNode;
    if (!parent || parent.isStackedOrTabbed()) return false;

    const tiled = this.tree.getTiledChildren(parent.childNodes);
    if (tiled.length <= 1) return false;

    const orientation = Utils.orientationFromLayout(parent.layout);
    const parentRect = parent.rect;
    if (!parentRect) return false;
    const parentSize =
      orientation === ORIENTATION_TYPES.HORIZONTAL ? parentRect.width : parentRect.height;
    if (!parentSize || parentSize <= 0) return false;

    const index = tiled.indexOf(node);
    if (index < 0) return false;
    // Pair with the next tiled sibling, or the previous one when `node` is last.
    const pair = index + 1 < tiled.length ? tiled[index + 1] : tiled[index - 1];
    if (!pair) return false;

    const delta = deltaPx / parentSize;
    node.percent = this._effectivePercent(node, orientation, parentSize) + delta;
    pair.percent = this._effectivePercent(pair, orientation, parentSize) - delta;
    this._normalizeSiblingPercents(parent);
    return true;
  }

  /**
   * forge-gm0z: a node's share of its parent split. Prefer the stored percent;
   * fall back to its current rect proportion (as _normalizeSiblingPercents does)
   * so expand works even before any manual resize has set an explicit percent.
   */
  _effectivePercent(node, orientation, parentSize) {
    if (node.percent && node.percent > 0) return node.percent;
    if (node.rect && parentSize > 0) {
      const size =
        orientation === ORIENTATION_TYPES.HORIZONTAL ? node.rect.width : node.rect.height;
      return size / parentSize;
    }
    return 0;
  }

  /**
   * forge-zlg: resize the focused tiled window to the golden-ratio share of its
   * split, on demand. Unlike expand()/shrink() (a pixel delta applied on both
   * axes), this sets an ABSOLUTE ratio on a SINGLE axis — golden ratio is a
   * statement about one split, and a two-axis pass would compound to ~0.382 in
   * nested layouts. No-op (no render) when there is no focused tiled window.
   */
  applyGoldenRatio() {
    let focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (!focusNodeWindow || !focusNodeWindow.isTile()) return;
    if (this._goldenRatioAgainstPair(focusNodeWindow)) {
      this.renderTree("window-golden-ratio");
    }
  }

  /**
   * forge-zlg: give `node` the golden share of the space it shares with its split
   * pair, debiting the pair — mirroring _expandNodeAgainstPair() (same guards and
   * pair-selection) but absolute instead of incremental. The pair is the next
   * tiled sibling, or the previous one when `node` is last, so the FOCUSED window
   * takes the larger (φ) share regardless of its position. Operating on the
   * pair's combined share (not the whole parent) leaves any other siblings in a
   * 3+ window split untouched. Returns true when a percent was changed.
   */
  _goldenRatioAgainstPair(node) {
    const parent = node.parentNode;
    if (!parent || parent.isStackedOrTabbed()) return false;

    const tiled = this.tree.getTiledChildren(parent.childNodes);
    if (tiled.length <= 1) return false;

    const orientation = Utils.orientationFromLayout(parent.layout);
    const parentRect = parent.rect;
    if (!parentRect) return false;
    const parentSize =
      orientation === ORIENTATION_TYPES.HORIZONTAL ? parentRect.width : parentRect.height;
    if (!parentSize || parentSize <= 0) return false;

    const index = tiled.indexOf(node);
    if (index < 0) return false;
    const pair = index + 1 < tiled.length ? tiled[index + 1] : tiled[index - 1];
    if (!pair) return false;

    const combined =
      this._effectivePercent(node, orientation, parentSize) +
      this._effectivePercent(pair, orientation, parentSize);
    node.percent = combined * GOLDEN;
    pair.percent = combined * (1 - GOLDEN);
    this._normalizeSiblingPercents(parent);
    return true;
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
    // forge-ph7f: cancel any pending per-window Wayland stacking pin and unpin
    // transiently-pinned windows so none is stranded "Always on Top" after the
    // tree is dropped (skips genuine user/float pins).
    this.allNodeWindows.forEach((node) => {
      const mw = node.nodeValue;
      if (!mw) return;
      if (mw._forgeStackTimeoutId) {
        GLib.Source.remove(mw._forgeStackTimeoutId);
        mw._forgeStackTimeoutId = 0;
      }
      if (mw._forgeTransientAbove) {
        try {
          if (Utils.isWindowAlive(mw) && mw.is_above() && !node._forgeSetAbove) {
            this._withSuppressedAboveHandler(() => mw.unmake_above());
          }
        } catch (e) {
          // Window may have been destroyed
        }
        mw._forgeTransientAbove = false;
      }
    });
    // forge-h6jc: remove the tree's scaffold bins from window_group before
    // dropping the tree, otherwise the root/workspace/monitor St.Bins leak.
    this._tree?.destroy();
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
    // forge-3jx9: resolve live. The extension constructs WindowManager before
    // Keybindings, so snapshotting this.ext.keybindings in the constructor froze
    // an undefined value forever, making allowDragDropTile() throw on every drag.
    return this.ext.keybindings;
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

    // forge-wf49: collect the tiled leaf windows to move into the monocle. INCLUDE
    // minimized windows: leaving them behind strands a nested CON that the prune
    // loop can't empty, so the monitor keeps 2 CONs and the user can never exit
    // monocle. (Float/grab-tile are still excluded — they aren't part of the grid.)
    const collectMonocleLeaves = () =>
      monitorNode.getNodeByType(NODE_TYPES.WINDOW).filter((w) => !w.isFloat() && !w.isGrabTile());

    // Check if we're already in monocle mode (single tabbed container holding ALL
    // tiled windows). forge-wf49: the last two clauses require the single CON to be
    // the monitor's ONLY tiled child — otherwise a loose tiled window beside a
    // user-made tabbed group is misread as monocle and the toggle destructively
    // flattens the group instead of entering monocle.
    const containerNodes = monitorNode.getNodeByType(NODE_TYPES.CON);
    const isMonocle =
      containerNodes.length === 1 &&
      containerNodes[0].layout === LAYOUT_TYPES.TABBED &&
      containerNodes[0].childNodes.length > 1 &&
      tiledWindows.length === 1 &&
      tiledWindows[0] === containerNodes[0];

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
      let leafWindows = collectMonocleLeaves();
      if (leafWindows.length === 0) return;

      let targetContainer = containerNodes[0];
      if (!targetContainer) {
        // No container yet: push the first window down into a fresh container.
        // split() replaces the window node with a new one inside the container,
        // so re-collect the leaf set afterwards.
        this.tree.split(leafWindows[0], ORIENTATION_TYPES.HORIZONTAL, true);
        targetContainer = leafWindows[0].parentNode;
        leafWindows = collectMonocleLeaves();
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

  hideActorBorder(...a) {
    return this.decorationManager.hideActorBorder(...a);
  }

  hideWindowBorders(...a) {
    return this.decorationManager.hideWindowBorders(...a);
  }

  // Window movement API
  // Bug #224 fix: Align dimension to buffer scale (for Wayland HiDPI)
  _alignToBufferScale(value, scale = 2) {
    return Math.round(value / scale) * scale;
  }

  // Bug #1: getWorkAreaSafe() returns the window's CURRENT monitor's work area,
  // so clamping a cross-monitor destination rect against it snaps the window back
  // onto the source monitor. Resolve the work area from the TARGET rect's monitor
  // instead. Falls back to the current-monitor work area when the per-rect APIs
  // are unavailable (keeps single-monitor behavior unchanged).
  _resolveTargetWorkArea(metaWindow, rect, workArea) {
    if (workArea) return workArea;
    try {
      const monitorIdx = global.display?.get_monitor_index_for_rect?.(rect);
      if (monitorIdx >= 0) {
        const ws = global.workspace_manager?.get_active_workspace?.();
        const wa = ws?.get_work_area_for_monitor?.(monitorIdx);
        if (wa) return wa;
      }
    } catch (e) {
      // fall through to the current-monitor work area
    }
    return Utils.getWorkAreaSafe(metaWindow);
  }

  move(metaWindow, rect, workArea = null, { skipOffscreenClamp = false } = {}) {
    if (!metaWindow) return;
    // forge-r2k9: don't reposition a window under a live interactive grab — an
    // out-of-band renderTree would teleport it mid-drag/resize. The old
    // `metaWindow.grabbed` guard tested a Meta.Window property Forge never sets, so
    // it never fired; use Forge's own grab state (grabMode / _draggedNodeWindow,
    // set in _handleGrabOpBegin) instead. The grab itself repositions via
    // move_frame() directly, not through move(), so this doesn't fight the gesture.
    const grabbedNode = this.findNodeWindow(metaWindow);
    if (grabbedNode && (grabbedNode.grabMode || grabbedNode === this._draggedNodeWindow)) return;

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
      const wa = this._resolveTargetWorkArea(metaWindow, rect, workArea);
      if (wa) {
        if (minW > width) x = Math.max(wa.x, Math.min(x, wa.x + wa.width - minW));
        if (minH > height) y = Math.max(wa.y, Math.min(y, wa.y + wa.height - minH));
      }
    }

    // Bug #224 fix: Align dimensions to buffer scale on Wayland
    if (Meta.is_wayland_compositor && Meta.is_wayland_compositor()) {
      const scale = Utils.dpi(); // Get display scale factor
      if (scale > 1) {
        x = this._alignToBufferScale(x, scale);
        y = this._alignToBufferScale(y, scale);
        width = this._alignToBufferScale(width, scale);
        height = this._alignToBufferScale(height, scale);
      }
    }

    // forge-aydd: keep the committed frame within the work area. Paths that bypass
    // computeSizes (keyboard resize() of a float, rectForMonitor() onto a smaller
    // monitor, a stale float rect) can hand move() a rect whose right/bottom runs
    // off-screen. Position-only — never shrink — so this generalizes the Bug #117
    // min-size clamp above rather than fighting it: Mutter commits max(width, minW),
    // so clamp by that effective size. A window larger than the whole work area pins
    // to the top-left (controls reachable). Runs after buffer-scale alignment (so it
    // can't be nudged back out) and before the frame-match early-return (so the early
    // return sees the clamped position).
    // A resize must change size only, never reposition (Bug #6), so it passes
    // skipOffscreenClamp to let the dragged edge grow off-screen instead of
    // shifting the whole window up/left.
    if (!skipOffscreenClamp) {
      const wa = this._resolveTargetWorkArea(metaWindow, rect, workArea);
      if (wa) {
        const ew = Math.max(width, minW);
        const eh = Math.max(height, minH);
        if (x + ew > wa.x + wa.width) x = Math.max(wa.x, wa.x + wa.width - ew);
        if (y + eh > wa.y + wa.height) y = Math.max(wa.y, wa.y + wa.height - eh);
      }
    }

    // forge-wsc (#351) / forge-05l (#454): renderTree fires on every tracked
    // focus change and tree.apply() re-moves every tiled window, so an
    // unchanged frame was re-asserted (and its in-flight shell animations
    // stripped) on every render. Skip when the window already sits at the
    // rect Mutter would commit (min-size hints hold the frame at min_* when
    // the slot is smaller). Any maximized axis must not skip: move() doubles
    // as the un-maximizer for the render pipeline.
    const frame = metaWindow.get_frame_rect();
    if (
      Compat.getMaximizeFlags(metaWindow) === 0 &&
      frame.x === x &&
      frame.y === y &&
      frame.width === Math.max(width, minW) &&
      frame.height === Math.max(height, minH)
    ) {
      return;
    }

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
    let currentWorkArea = Utils.getWorkAreaSafe(node.nodeValue);
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

      // forge-cm69: rect.{x,y} are ABSOLUTE stage coordinates, so the remap must
      // offset relative to the source work area before scaling and re-add the
      // destination origin. Using absolute coords directly placed the window
      // off-screen whenever the source monitor was not at the origin (3+ monitor
      // rows). One affine helper keeps both axes consistent (DRY).
      const remapAxis = (coord, curOrigin, curSize, nextOrigin, nextSize) =>
        ((coord - curOrigin) / curSize) * nextSize + nextOrigin;

      rect.y = remapAxis(
        rect.y,
        currentWorkArea.y,
        currentWorkArea.height,
        nextWorkArea.y,
        nextWorkArea.height
      );
      rect.x = remapAxis(
        rect.x,
        currentWorkArea.x,
        currentWorkArea.width,
        nextWorkArea.x,
        nextWorkArea.width
      );
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

    // forge-lvhp: windowsAllWorkspaces (get_tab_list NORMAL_ALL) excludes
    // DIALOG/MODAL_DIALOG, but trackWindow connects windowSignals/actorSignals to
    // those window types too — so a still-open tracked dialog would keep live
    // handlers bound to this disabled manager. Union the tab list with the tree's
    // WINDOW nodes (which include dialogs) so every tracked window is
    // disconnected. The tree is still live here (nulled later in disable());
    // de-dup by metaWindow identity.
    const allWindows = new Set(this.windowsAllWorkspaces || []);
    for (const wNode of this._tree ? this._tree.getNodeByType(NODE_TYPES.WINDOW) : []) {
      if (wNode.nodeValue) allWindows.add(wNode.nodeValue);
    }

    for (const metaWindow of allWindows) {
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

    this._clearTimeoutId("_renderTreeSrcId");
    this._clearTimeoutId("_reloadTreeSrcId");
    this._clearTimeoutId("_wsWindowAddSrcId");
    this._wsWindowAddQueue = null; // forge-wqlx: drain the pending re-home queue
    this._clearTimeoutId("_windowHomeReconcileSrcId");
    this._clearTimeoutId("_queueSourceId");
    this._clearTimeoutId("_manualResizeEndId");
    this._clearTimeoutId("_pointerFocusTimeoutId");
    this._clearTimeoutId("_workspaceChangingTimeoutId");

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
            // forge-4b6: must run before anything walks the tree — one dead
            // wrapper would throw out of this callback and abort the render.
            this.tree.pruneDeadWindows();
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
      // forge-te9o: never touch a node mid-drag. The float setter writes mode =
      // TILE, which would clobber GRAB_TILE and silently kill the in-flight drag.
      // Mirrors getTiledChildren's GRAB_TILE exclusion.
      if (nodeWindow.isGrabTile()) return;
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

    const wa = Utils.getWorkAreaSafe(metaWindow);
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

  showWindowBorders(...a) {
    return this.decorationManager.showWindowBorders(...a);
  }

  updateBorderLayout(...a) {
    return this.decorationManager.updateBorderLayout(...a);
  }

  calculateGaps(...a) {
    return this.decorationManager.calculateGaps(...a);
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
    // Make window types configurable
    if (this._validWindow(metaWindow)) {
      let existNodeWindow = this.tree.findNode(metaWindow);
      Logger.debug(`Meta Window ${metaWindow.get_title()} ${metaWindow.get_window_type()}`);
      if (!existNodeWindow) {
        // forge-mhje: auto-split must run ONLY for a genuinely new, valid window,
        // and before it attaches — never for popups/tooltips (fail _validWindow) or
        // reload re-tracks (existNodeWindow truthy), which would otherwise wrap the
        // focused window in a phantom single-child CON.
        if (this.ext.settings.get_boolean("auto-split-enabled") && this.focusMetaWindow) {
          let currentFocusNode = this.tree.findNode(this.focusMetaWindow);
          if (currentFocusNode) {
            let layout = currentFocusNode.parentNode.layout;
            if (layout === LAYOUT_TYPES.HSPLIT || layout === LAYOUT_TYPES.VSPLIT) {
              let frameRect = this.focusMetaWindow.get_frame_rect();
              let orientation = frameRect.width > frameRect.height ? "horizontal" : "vertical";
              this.command({ name: "Split", orientation: orientation });
            }
          }
        }
        // forge-tnth (#299/#427/#388/#353): where to initially home a new window.
        // 'pointer' (default) uses the active/pointer monitor as before;
        // 'window-actual' places it on the window's own monitor from the start,
        // matching where updateMetaWorkspaceMonitor would re-home it anyway and
        // avoiding a redundant re-home for apps that restore their own geometry.
        const placement = this.ext.settings.get_string("new-window-placement");
        // On Wayland get_monitor() can be -1 before the window is positioned;
        // fall back to the pointer monitor so we don't build an invalid
        // monitor-workspace id and fire a spurious reloadTree. (forge-4cv/4dm/91s/vmx)
        const windowMonitor = metaWindow.get_monitor();
        const activeMonitor =
          placement === "window-actual" && windowMonitor >= 0
            ? windowMonitor
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

        const attachTarget = this._resolveAttachTarget(metaMonWsNode, windowNodes, hasWindows);

        let nodeWindow = this.tree.createNode(
          attachTarget.nodeValue,
          NODE_TYPES.WINDOW,
          metaWindow,
          WINDOW_MODES.FLOAT
        );

        metaWindow.firstRender = true;

        let windowActor = metaWindow.get_compositor_private();

        this._bindWindowSignals(metaWindow, windowActor);

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
        // forge-3hsv: but only for windows that will actually tile. Permanently
        // float-exempt windows (dialogs, transients, always-on-top) are created
        // FLOAT and never tile, so carving them a share would leave the tiled
        // siblings summing < 1 and corrupt the split. isFloatingExempt reads the
        // window type/overrides available now; isFloat() can't be used here
        // because every new node is FLOAT until processFloats runs.
        if (!this.isFloatingExempt(metaWindow)) {
          this.tree.insertChildPercent(nodeWindow.parentNode, nodeWindow);
        }
      }
    }
  }

  /**
   * Resolve the node a brand-new window should attach under, within the active
   * monitor/workspace container (metaMonWsNode). Precedence:
   *   1. the tree's current attachNode, if it still resolves;
   *   2. Feature #227 fallback: the last focused window, when it lives under this
   *      monitor/workspace;
   *   3. otherwise this monitor/workspace container itself.
   * When an attach target is found but this container already has windows, the
   * target is only honored if it lives here; else we attach to the first window
   * here so the new window lands beside its visible neighbors.
   */
  _resolveAttachTarget(metaMonWsNode, windowNodes, hasWindows) {
    let attachTarget = this.tree.attachNode;
    attachTarget = attachTarget ? this.tree.findNode(attachTarget.nodeValue) : null;

    // Feature #227: Use last focused window as fallback when no attach target
    if (!attachTarget && this.lastFocusedWindow) {
      const lastFocusNode = this.tree.findNode(this.lastFocusedWindow.nodeValue);
      if (lastFocusNode && metaMonWsNode.contains(lastFocusNode)) {
        attachTarget = lastFocusNode;
      }
    }

    if (!attachTarget) return metaMonWsNode;
    if (!hasWindows) return metaMonWsNode;
    return metaMonWsNode.contains(attachTarget) ? attachTarget : windowNodes[0];
  }

  /**
   * Bind the per-window and per-actor signals for a newly tracked window, once.
   * The handlers close over windowActor (border hiding) and `this`; they are
   * stored on metaWindow.windowSignals / windowActor.actorSignals for disable().
   */
  _bindWindowSignals(metaWindow, windowActor) {
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
          // forge-ph7f: drop any pending Wayland stacking-pin timer for a
          // closed window so it can't fire against a destroyed MetaWindow.
          if (_metaWindow._forgeStackTimeoutId) {
            GLib.Source.remove(_metaWindow._forgeStackTimeoutId);
            _metaWindow._forgeStackTimeoutId = 0;
          }
          _metaWindow._forgeTransientAbove = false;
        }),
        metaWindow.connect("focus", (_metaWindowFocus) => {
          this.queueEvent({
            name: "focus-update",
            callback: () => {
              this.unfreezeRender();
              this.updateBorderLayout();
              this.updateDecorationLayout();
              // forge-d5mm: these no-op on a falsy arg, so the focused node
              // must be resolved and passed — otherwise click/alt-tab/hover
              // focus never re-stacks a STACKED or raises a TABBED container.
              let focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
              this.updateStackedFocus(focusNodeWindow);
              this.updateTabbedFocus(focusNodeWindow);
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
                  // Raise the focused float above the tiled grid (and other
                  // floats) instead of pinning dialogs always-on-top. Mutter
                  // raises transient children with their parent, so a focused
                  // window keeps its popup on top. Re-resolve focus live: the
                  // callback runs at idle and focus may have moved on.
                  // forge-5l9b: but never a float demoted under a fullscreen
                  // window — raise() would undo the reconcile's lower() without
                  // touching is_above(), so nothing would ever re-demote it.
                  const fw = this.focusMetaWindow;
                  const fwNode = fw ? this.tree.findNode(fw) : null;
                  if (fwNode && this.floatingWindow(fwNode) && !fwNode._aboveDemotedForFullscreen)
                    fw.raise();
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
          // forge-2uc0: those same apps had a null Shell app at map time, so the
          // node never built a tab. Refresh the node's app + tab before render.
          this.tree.findNode(_metaWindow)?.refreshApp();
          this.renderTree("wm-class-changed");
        }),
      ];
      metaWindow.windowSignals = windowSignals;
    }

    if (!windowActor.actorSignals) {
      let actorSignals = [windowActor.connect("destroy", this.windowDestroy.bind(this))];
      windowActor.actorSignals = actorSignals;
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
      }
      // forge-f081: the old else-branch called movePointerWith(metaWindow), but
      // movePointerWith expects a tree Node (it guards on ._data) so the raw
      // Meta.Window made it a no-op since 2023. Pointer-follow for a new focus-
      // stealing window is already handled by the queued focus handler with a
      // proper Node — the dead call is removed rather than "fixed" into a warp
      // that would yank the pointer to non-focus-stealing new windows.
    }
  }

  updateStackedFocus(focusNodeWindow) {
    return this.focusManager.updateStackedFocus(focusNodeWindow);
  }

  updateTabbedFocus(focusNodeWindow) {
    return this.focusManager.updateTabbedFocus(focusNodeWindow);
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

  _destroyActorBorder(...a) {
    return this.decorationManager._destroyActorBorder(...a);
  }

  windowDestroy(actor) {
    // Release any resources on the window
    this._destroyActorBorder(actor, "border");
    this._destroyActorBorder(actor, "splitBorder");

    let nodeWindow;
    nodeWindow = this.tree.findNodeByActor(actor);

    // forge-s02h: lastFocusedWindow is dereferenced inside deferred pointer
    // warps (storePointerLastPosition); clear it when its node closes so it
    // can't survive as a stale/disposed reference.
    if (nodeWindow && this.lastFocusedWindow === nodeWindow) {
      this.lastFocusedWindow = null;
    }

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
      // forge-dvce: runs synchronously inside windowDestroy pre-prune, so a
      // finalized sibling wrapper's .minimized/raise() would throw and abort the
      // rest of the destroy (queued render never enqueued).
      if (!Utils.isWindowAlive(metaWindow) || metaWindow.minimized) return false;
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
    const candidates = wsNode.getNodeByType(NODE_TYPES.WINDOW).filter(
      (node) =>
        node !== restore.closedNodeWindow &&
        // forge-dvce: guard get_window_type() against finalized wrappers.
        Utils.isWindowAlive(node.nodeValue) &&
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
              if (this.grabOp !== Meta.GrabOp.WINDOW_BASE) this.updateTabbedFocus(existNodeWindow);
              this.updateStackedFocus(existNodeWindow);
            } else {
              // forge-5l9b: skip floats demoted under a fullscreen window —
              // raise() would silently undo _reconcileFullscreenFloatDemotion.
              if (
                this.floatingWindow(existNodeWindow) &&
                !existNodeWindow._aboveDemotedForFullscreen
              ) {
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
      this._rehomeWindowToLiveLocation(wNode);
    }
  }

  /**
   * forge-6pe / forge-ojew: Re-home a single window node to the monitor node that
   * matches its Meta.Window's live (monitor, workspace), preserving an intact
   * sub-tree. No-op when the window is invalid, has no workspace, the destination
   * node doesn't exist, or it already lives there. Shared by the settled idle
   * reconcile and the synchronous workspace-removed rehome.
   *
   * @param {Node} wNode - The tracked window node to re-home.
   */
  _rehomeWindowToLiveLocation(wNode) {
    const metaWindow = wNode.nodeValue;
    // forge-c2yp: a finalized wrapper (missed-actor-destroy race) throws on the
    // first property read; _validWindow's get_wm_class() would abort the whole
    // workspace-removed handler. Skip dead nodes — the render prune collects them.
    if (!Utils.isWindowAlive(metaWindow)) return;
    if (!this._validWindow(metaWindow)) return;
    const ws = metaWindow.get_workspace();
    if (!ws) return;
    const destNode = this.tree.findNode(
      Utils.createMonitorWorkspaceId(metaWindow.get_monitor(), ws.index())
    );
    if (!destNode || destNode.contains(wNode)) return;
    this._rehomeWindowPreservingContainer(wNode, metaWindow, destNode);
  }

  /**
   * forge-ojew: Before a workspace subtree is spliced out (workspace-removed),
   * synchronously re-home its still-tracked window descendants to the surviving
   * workspace their Meta.Window now reports. Mutter emits each window's
   * 'workspace-changed' (queued for idle reconcile) BEFORE the synchronous
   * 'workspace-removed', so removeChild would otherwise detach those WINDOW nodes
   * and strand them — the idle reconcile, running later, can no longer find them.
   * Rehoming here keeps them tiled; the subsequent removeWorkspace then splices a
   * window-free subtree. Windows without a valid surviving destination are left for
   * the existing idle reconcile / workareas fallback.
   *
   * @param {number} wsIndex - Index of the workspace about to be removed.
   */
  _rehomeWorkspaceWindowsBeforeRemoval(wsIndex) {
    const wsNode = this.tree.findNode(`ws${wsIndex}`);
    if (!wsNode) return;
    // Snapshot: rehoming mutates the tree (moves nodes out of this subtree).
    const windowNodes = [...wsNode.getNodeByType(NODE_TYPES.WINDOW)];
    for (const wNode of windowNodes) {
      // forge-c2yp: never let one node abort the caller — removeWorkspace and the
      // index renumber MUST still run, or the ws-index scaffold desyncs for good.
      try {
        this._rehomeWindowToLiveLocation(wNode);
      } catch (e) {
        Logger.warn(`_rehomeWorkspaceWindowsBeforeRemoval: skipping node: ${e}`);
      }
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
    // The _queueWindowHomeReconcile idle that reaches here has no try/catch; a
    // window closing during a multi-workspace shift can finalize the wrapper, so
    // probe liveness before get_workspace() (forge-7bry — consistent with the
    // per-node guard in the .every() below).
    if (!Utils.isWindowAlive(metaWindow)) return false;
    const destWs = metaWindow.get_workspace();
    if (!destWs) return false;
    const destWsIndex = destWs.index();
    const destMon = metaWindow.get_monitor();
    const windowNodes = node.getNodeByType(NODE_TYPES.WINDOW);
    if (!windowNodes || windowNodes.length === 0) return false;
    return windowNodes.every((wn) => {
      const mw = wn.nodeValue;
      // forge-c2yp: a finalized sibling throws when get_workspace() is CALLED, so
      // the method-exists truthiness check isn't enough — probe real liveness.
      const ws = Utils.isWindowAlive(mw) ? mw.get_workspace() : null;
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
      // forge-v4wh: a maximize/fullscreen that lands inside the 120ms keyboard-resize
      // debounce arrives as a size-changed with grabMode still RESIZING. Feeding that
      // maximized frame to _handleResizing consumes ~half the monitor as a resize
      // delta and permanently skews the split percents. Reject the maximize the same
      // way the non-grab branch does, ending the synthesized grab so no further
      // size-changed is consumed as a resize; and never route a maximized/fullscreen
      // frame into _handleResizing (the lone-window case, left for maximize-on-single).
      if (this._shouldRejectExternalMaximize(focusNodeWindow, focusMetaWindow)) {
        this._clearTimeoutId("_manualResizeEndId");
        this._manualResizeEndWindow = null;
        this._grabCleanup(focusNodeWindow);
        Compat.unmaximize(focusMetaWindow);
        this.renderTree(from);
      } else if (
        focusNodeWindow.grabMode === GRAB_TYPES.RESIZING &&
        Compat.getMaximizeFlags(focusMetaWindow) === 0 &&
        !(focusMetaWindow.is_fullscreen && focusMetaWindow.is_fullscreen())
      ) {
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

  /**
   * forge-dyt2: a LONE tiled window may be legitimately maximized — an external
   * maximize the signal path intentionally leaves alone (the complement of
   * _shouldRejectExternalMaximize, which only fights the >1-window case), or
   * window-maximize-on-single. tree.apply must not re-slice it, because move()
   * doubles as the un-maximizer and would silently revert the maximize on the
   * next render. Shares _tiledWindowsOnMonitor with _shouldRejectExternalMaximize
   * and handleMaximizeOnSingle so the three never disagree — drift here risks an
   * unmaximize<->maximize render loop (this predicate only SKIPS an unmaximize, so
   * it cannot itself introduce one).
   */
  _isLoneMaximizedTile(node) {
    if (!node || node.mode !== WINDOW_MODES.TILE) return false;
    const metaWindow = node.nodeValue;
    if (!metaWindow) return false;
    if (metaWindow.is_fullscreen && metaWindow.is_fullscreen()) return false;
    if (Compat.getMaximizeFlags(metaWindow) === 0) return false;
    const monitor = this.tree.findAncestorMonitor(node);
    return this._tiledWindowsOnMonitor(monitor).length === 1;
  }

  updateDecorationLayout(...a) {
    return this.decorationManager.updateDecorationLayout(...a);
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
  // Dispatch a GSettings "changed" signal. Extracted from the connect() closure so
  // the routing is unit-testable (the mock settings object emits no signals).
  _onSettingsChanged(settingName) {
    const settings = this.ext.settings;
    switch (settingName) {
      case "window-overrides-reload-trigger":
        // Reload window overrides when triggered by preferences
        // This prevents the main extension from overwriting changes made by preferences.
        // Keep live per-window (wmId) FloatToggle overrides from this session (forge-8rm6).
        this.reloadWindowOverrides(false);
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
      case "monitor-skip-tile":
      case "stacked-tab-bar-height":
      case "tab-position":
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
  }

  _onMinimizeChange(
    reason,
    { hideBorders = false, resetGrandparentIfEmpty = false, metaWindow = null } = {}
  ) {
    if (hideBorders) this.hideWindowBorders();
    // forge-43zk: reset the container of the window the signal is actually about,
    // not whatever holds the display focus — a background (un)minimize (dock,
    // self-minimize, wmctrl) would otherwise wipe the focused container's ratios.
    let changedNodeWindow = this.tree.findNode(metaWindow || this.focusMetaWindow);
    if (changedNodeWindow) {
      if (
        resetGrandparentIfEmpty &&
        this.tree.getTiledChildren(changedNodeWindow.parentNode.childNodes).length === 0
      ) {
        this.tree.resetSiblingPercent(changedNodeWindow.parentNode.parentNode);
      }
      this.tree.resetSiblingPercent(changedNodeWindow.parentNode);
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
  movePointerWith(...args) {
    return this.focusManager.movePointerWith(...args);
  }

  warpPointerToNodeWindow(...args) {
    return this.focusManager.warpPointerToNodeWindow(...args);
  }

  getPointer() {
    return global.get_pointer();
  }

  minimizedWindow(node) {
    if (!node) return false;
    return node._type === NODE_TYPES.WINDOW && node._data && node._data.minimized;
  }

  swapWindowsUnderPointer(focusNodeWindow) {
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

    // Reset these flags on focusNodeWindow, not childNode — the two can differ.
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
    if (!focusNodeWindow || focusNodeWindow.mode !== WINDOW_MODES.GRAB_TILE) return;

    const nodeWinAtPointer = this.nodeWinAtPointer;
    if (!nodeWinAtPointer) return;

    // Bug #328 fix: Validate node structure before accessing.
    // forge-o09u: nodeWinAtPointer is cached by the last motion; a fast Wayland
    // close can finalize its wrapper before the drop, so probe liveness before
    // get_frame_rect() below (mirrors the preview path, forge-xom3).
    if (
      !nodeWinAtPointer.nodeValue ||
      !nodeWinAtPointer.parentNode ||
      !Utils.isWindowAlive(nodeWinAtPointer.nodeValue)
    ) {
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
    // forge-s02h: this.lastFocusedWindow can point at a disposed Meta.Window
    // (focused window closed / app exited across suspend) whose wrapper keeps
    // _data truthy; guard liveness so get_frame_rect() can't throw.
    if (nodeWindow && nodeWindow._data && Utils.isWindowAlive(nodeWindow.nodeValue)) {
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
    return this.focusManager._focusWindowUnderPointer();
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

    const activeWorkspace = global.workspace_manager?.get_active_workspace();

    // Iterate through the windows in reverse order to get the top-most window
    for (let i = windows.length - 1; i >= 0; i--) {
      let window = windows[i];
      let metaWindow = window.meta_window;

      // forge-h7fb: get_window_actors() is display-wide, and neither a minimized
      // window nor one on another workspace loses its frame rect or its stacking
      // slot. Such a window would match the pointer first and shadow the real
      // hover target — _focusWindowUnderPointer then focuses something invisible
      // and returns, killing focus-on-hover for that region. isWindowAlive first:
      // this runs in a 16ms timeout whose GSource is removed if we throw, and
      // these accessors throw on a finalized wrapper (forge-e5mh).
      if (!Utils.isWindowAlive(metaWindow)) continue;
      if (metaWindow.minimized) continue;
      if (activeWorkspace && !metaWindow.located_on_workspace(activeWorkspace)) continue;

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
      // forge-xom3: sortedWindows is snapshotted at grab start and not pruned
      // when a window closes mid-drag; skip dead wrappers so get_frame_rect()
      // can't throw and a disposed window can't mask a live drop target beneath.
      if (!Utils.isWindowAlive(w)) continue;
      const metaRect = w.get_frame_rect();
      const atPointer = Utils.rectContainsPoint(metaRect, pointer);
      if (atPointer) return this.tree.getNodeByValue(w);
    }

    return null;
  }

  _handleGrabOpBegin(_display, _metaWindow, grabOp) {
    // forge-h6z9: cancel any pending debounced keyboard-resize end so a delayed
    // _handleGrabOpEnd can't fire into this grab (e.g. a real pointer grab that
    // begins <120ms after a keyboard resize, which would unfreeze/cleanup and
    // kill the live drag). The keyboard key-repeat path calls this from resize()
    // and immediately re-arms the timer afterward, so accumulation is preserved.
    this._clearTimeoutId("_manualResizeEndId");
    this._manualResizeEndWindow = null;

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
      // forge-ue92: record the exact ancestors we snapshot so _grabCleanup can
      // clear THESE nodes. _handleGrabOpEnd reparents the dragged node
      // (moveWindowToPointer) BEFORE cleanup, so re-walking parentNode at cleanup
      // time would clear the post-reparent chain and strand initRect on the
      // original container — skewing its next tab resize.
      const grabbedTabbedAncestors = [];
      let tabbedAncestor = focusNodeWindow.parentNode;
      while (tabbedAncestor && tabbedAncestor.isStackedOrTabbed()) {
        if (!tabbedAncestor.initRect) tabbedAncestor.initRect = { ...tabbedAncestor.rect };
        grabbedTabbedAncestors.push(tabbedAncestor);
        tabbedAncestor = tabbedAncestor.parentNode;
      }
      focusNodeWindow.grabbedTabbedAncestors = grabbedTabbedAncestors;

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
      // forge-62ja: also clear the per-grab state the normal exit path clears
      // (below), so a stale grabOp from this finished drag can't defeat the
      // forge-leqs WINDOW_BASE guard in updateMetaWorkspaceMonitor on a later
      // cross-monitor/workspace re-home before the next grab re-sets it.
      this.nodeWinAtPointer = null;
      this.grabOp = null;
      return;
    }
    let focusNodeWindow = this.findNodeWindow(focusMetaWindow);

    if (focusNodeWindow) {
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
    // forge-leqs: grabOp is the live grab; clear it once the grab ends so later
    // reads (e.g. the WINDOW_BASE guard in updateMetaWorkspaceMonitor) don't see
    // a stale op from a finished drag. A new grab re-sets it in _handleGrabOpBegin
    // before any size-changed handler runs.
    this.grabOp = null;
  }

  _grabCleanup(focusNodeWindow) {
    if (!focusNodeWindow) return;
    focusNodeWindow.initRect = null;
    focusNodeWindow.grabMode = null;
    focusNodeWindow.initGrabOp = null;
    focusNodeWindow.pairInitRects = null;

    // Bug #497 (forge-pak): release any tabbed/stacked container snapshots too.
    // forge-ue92: clear the ancestors snapshotted at grab-begin, NOT the current
    // parentNode chain — the node may have been reparented (tab dragged out) or
    // left the tree before this runs, which would otherwise strand initRect on the
    // original container and skew/bake its next resize.
    if (focusNodeWindow.grabbedTabbedAncestors) {
      for (const ancestor of focusNodeWindow.grabbedTabbedAncestors) {
        ancestor.initRect = null;
      }
      focusNodeWindow.grabbedTabbedAncestors = null;
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

    // forge-yz41: anchor BOTH the container's start slice and the pair on their
    // grab-begin rects, snapshotted on the grabbed window like the same-parent
    // branch (forge-12f). Reading live rects here re-debits the cumulative
    // changePx across X11's multiple size-changed events per move and drifts the
    // shared edge past the pointer.
    const startRect = container.initRect || this._pairInitRect(grabbedWindow, container);
    const pairRect = this._pairInitRect(grabbedWindow, pair);
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

  /**
   * forge-12f (gh-305): start-of-grab anchor for the resize pair. On X11
   * (observed on Mutter 48) one move_resize_frame emits SEVERAL size-changed
   * events, so _handleResizing runs multiple times per step with a CUMULATIVE
   * changePx. The focused window is anchored on its frozen initRect; the pair
   * must be anchored the same way, or every extra pass re-debits its live,
   * already-debited node rect and the slack drifts into the other siblings on
   * normalize (the opposite boundary moves). Snapshots live on the focus node
   * and are released with the grab in _grabCleanup.
   */
  _pairInitRect(focusNodeWindow, resizePairForWindow) {
    if (!focusNodeWindow.pairInitRects) focusNodeWindow.pairInitRects = new Map();
    let init = focusNodeWindow.pairInitRects.get(resizePairForWindow);
    if (!init) {
      init = { ...resizePairForWindow.rect };
      focusNodeWindow.pairInitRects.set(resizePairForWindow, init);
    }
    return init;
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

      // forge-0dhz: the horizontal and vertical resize math is identical except
      // for which rect dimension is read/divided by, so key it on sizeKey instead
      // of duplicating ~70 lines per axis. An unknown orientation still falls
      // through to _repositionDuringResize untouched (no final else).
      if (
        orientation === ORIENTATION_TYPES.HORIZONTAL ||
        orientation === ORIENTATION_TYPES.VERTICAL
      ) {
        const sizeKey = orientation === ORIENTATION_TYPES.HORIZONTAL ? "width" : "height";
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
              secondRect = this._pairInitRect(focusNodeWindow, resizePairForWindow);
            }
          }

          if (!firstRect || !secondRect) {
            return;
          }

          parentRect = parentNodeForFocus.rect;
          let changePx = currentRect[sizeKey] - firstRect[sizeKey];
          let firstPercent = (firstRect[sizeKey] + changePx) / parentRect[sizeKey];
          let secondPercent = (secondRect[sizeKey] - changePx) / parentRect[sizeKey];
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
            // index = resizePairForWindow.index ± 1 can land at -1 or past the end
            // at a parent boundary; childNodes[index] is then undefined and the
            // .rect read below throws inside the live size-changed handler
            // (forge-34c6). Bail before dereferencing.
            if (!parentNodeForFocus) return;
            // forge-yz41: anchor both sides on their grab-begin rects (snapshotted
            // on the focus node like the same-parent branch, forge-12f). Live rects
            // re-debit the cumulative changePx across X11's multiple size-changed
            // events per move and drift the boundary.
            firstRect = this._pairInitRect(focusNodeWindow, parentNodeForFocus);
            secondRect = this._pairInitRect(focusNodeWindow, resizePairForWindow);
            if (!firstRect || !secondRect) {
              return;
            }

            parentRect = parentNodeForFocus.parentNode.rect;
            let changePx = currentRect[sizeKey] - firstWindowRect[sizeKey];
            let firstPercent = (firstRect[sizeKey] + changePx) / parentRect[sizeKey];
            let secondPercent = (secondRect[sizeKey] - changePx) / parentRect[sizeKey];
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

  // Classify matching TILE overrides by specificity (forge-jbkg):
  //  - "specific" = targets this exact window via wmTitle or wmId (explicit intent)
  //  - "class-only" = matches on wmClass alone, so it matches EVERY window of the
  //    class — including the dialogs/transients/non-resizable windows the bundled
  //    config (Chrome, Evolution, Anki, ...) never meant to force into the grid.
  _classifyTileOverrides(metaWindow) {
    // Bug #294 fix: Check for explicit TILE override first (user preference takes precedence)
    const windowTitle = metaWindow.get_title();
    const wmClass = metaWindow.get_wm_class();
    const wmId = metaWindow.get_id();
    const allOverrides = this.windowProps.overrides;

    let hasSpecific = false;
    let hasClassOnly = false;
    for (const override of allOverrides) {
      if (override.mode !== "tile") continue;

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

      if (!(matchTitle && matchClass && matchId)) continue;

      if (override.wmTitle || override.wmId) {
        hasSpecific = true;
      } else {
        hasClassOnly = true;
      }
    }

    return { hasSpecific, hasClassOnly };
  }

  /**
   * Whether a single float override (`kf`) matches `metaWindow`. Shared by
   * _matchesFloatOverride and _matchesSpecificFloatOverride so the per-rule
   * title/class/id matching logic lives in exactly one place (DRY).
   */
  _matchesFloatRule(kf, metaWindow) {
    const windowTitle = metaWindow.get_title();
    let matchTitle = false;
    let matchClass = false;
    let matchId = false;

    if (kf.wmTitle) {
      if (kf.wmTitle === " ") {
        matchTitle = kf.wmTitle === windowTitle;
      } else {
        // forge-11k: titles are matched by substring (.includes), never exact,
        // so lowercasing both sides is safe and gives locale/casing fidelity for
        // titles like "Picture-in-Picture". The !-negation and comma-split are
        // preserved.
        const haystack = windowTitle ? windowTitle.toLowerCase() : windowTitle;
        let titles = kf.wmTitle.split(",");
        matchTitle =
          titles.filter((t) => {
            if (windowTitle) {
              if (t.startsWith("!")) {
                return !haystack.includes(t.slice(1).toLowerCase());
              } else {
                return haystack.includes(t.toLowerCase());
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
    // forge-n29i: a class-less float rule must be allowed to match on title
    // alone — when wmClass is absent, don't require matchClass. A rule with no
    // criteria at all (no wmClass, no wmTitle, no wmId) must match nothing.
    if (!kf.wmClass) {
      return Boolean(kf.wmTitle) && matchTitle;
    }
    return (!kf.wmTitle || matchTitle) && matchClass;
  }

  _matchesFloatOverride(metaWindow) {
    return this.windowProps.overrides.some(
      (kf) => kf.mode === "float" && this._matchesFloatRule(kf, metaWindow)
    );
  }

  // forge-11k: true iff some float override that carries a wmTitle OR wmId (i.e.
  // targets this specific window, not a bare class) matches. Lets a per-title PIP
  // float rule beat a bundled class-only tile rule for Chrome/Brave/Chromium.
  _matchesSpecificFloatOverride(metaWindow) {
    return this.windowProps.overrides.some(
      (kf) =>
        kf.mode === "float" && (kf.wmTitle || kf.wmId) && this._matchesFloatRule(kf, metaWindow)
    );
  }

  isFloatingExempt(metaWindow) {
    if (!metaWindow) return true;
    let windowTitle = metaWindow.get_title();
    let windowType = metaWindow.get_window_type();

    const { hasSpecific, hasClassOnly } = this._classifyTileOverrides(metaWindow);

    // App-specific float rules (Steam #271, Blender #260, Firefox PIP #383) live in
    // config/windows.json — the canonical override mechanism — rather than hardcoded here,
    // so they stay user-editable and don't contradict the config (forge-khb).

    // forge-jbkg: windows that float because of their TYPE/role (dialogs,
    // modals, transients, overlays) — as opposed to merely being non-resizable.
    // A bare class-only tile rule (e.g. the bundled "evolution"/"Google-chrome"
    // rules) must NOT drag these into the tile grid; an explicit per-title/per-id
    // tile rule still can. A non-resizable NORMAL window (e.g. Neovide, Bug #294)
    // is not type-floated, so a class-only tile rule still tiles it.
    let floatByRole =
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
      // forge-ph7f: skip the transient pin Forge sets during focus navigation,
      // otherwise rapid focus float-ejects tiled windows and they overlap.
      (metaWindow.is_above() && !metaWindow._forgeTransientAbove) ||
      // forge-yyum: a window the USER pinned "Always on Visible Workspace" is shown
      // on every workspace by Mutter, but the tree can only home it under one
      // workspace's container — leaving it tiled churns layouts as it is re-homed
      // onto each active workspace. Treat it as an overlay and float it, mirroring
      // the Always-on-Top rule above; un-pinning re-tiles it.
      // forge-16ms: test the user PIN (is_always_on_all_workspaces), NOT the
      // effective sticky state (is_on_all_workspaces). Under the GNOME default
      // workspaces-only-on-primary=true, Mutter makes every window on a NON-primary
      // monitor implicitly sticky with no user intent — using the effective state
      // float-ejected all such windows, so nothing ever tiled on secondary monitors.
      Compat.isAlwaysOnAllWorkspaces(metaWindow);

    let floatByType = floatByRole || !metaWindow.allows_resize();

    // forge-jbkg: explicit per-title/per-id tile intent always wins; a bare
    // class-only tile rule tiles ordinary windows of the class but leaves the
    // class's dialogs/transients/overlays to float by role.
    if (hasSpecific) return false;

    // forge-11k: a per-title/per-id float override beats a BARE class-only tile
    // rule. Checked AFTER hasSpecific (so an explicit per-title/per-id TILE still
    // force-tiles) but BEFORE the bare class-only tile check below — this is what
    // lets a "Picture-in-Picture" float rule win over the bundled class-only tile
    // rules for Chrome/Brave/Chromium.
    if (this._matchesSpecificFloatOverride(metaWindow)) return true;

    if (hasClassOnly && !floatByRole) return false;

    return floatByType || this._matchesFloatOverride(metaWindow);
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
  /**
   * Reload window overrides from the configuration file.
   * @param {boolean} pruneStaleWmId - When true (startup), drop per-window (wmId)
   *   overrides whose ids are stale from a prior session. Runtime reloads (prefs
   *   edits, ConfigReload) pass false so live FloatToggle'd overrides survive (forge-8rm6).
   */
  reloadWindowOverrides(pruneStaleWmId = true) {
    // Get fresh data from the ConfigManager
    const freshProps = this.ext.configMgr.windowProps;
    if (freshProps) {
      this.windowProps = freshProps;
      if (pruneStaleWmId) {
        const beforeLength = this.windowProps.overrides.length;
        this.windowProps.overrides = this.windowProps.overrides.filter(
          (override) => !override.wmId
        );
        // forge-6c0e: persist the prune. configMgr.windowProps re-reads the file on
        // every access, so a cache-only prune is undone by the first
        // _updateWindowOverrides (window close / float toggle), which reads the
        // still-unpruned file back into the cache and resurrects every stale wmId row.
        if (this.windowProps.overrides.length !== beforeLength) {
          this.ext.configMgr.windowProps = this.windowProps;
        }
      }
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
