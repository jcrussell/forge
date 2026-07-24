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
import St from "gi://St";

// Shared state
import { Logger } from "../shared/logger.js";

// App imports
import { NODE_TYPES, LAYOUT_TYPES } from "./tree.js";
import * as Utils from "./utils.js";

/**
 * WorkspaceManager handles workspace-related operations for the tiling tree.
 * Extracted from tree.js and window.js to consolidate workspace logic.
 */
export class WorkspaceManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /** @type {import('./tree.js').Tree} */
  _tree;

  /** @type {import('./window.js').WindowManager} */
  _extWm;

  /** @type {Map<number, number[]>} Map of workspace index to signal IDs */
  _workspaceSignals = new Map();

  /**
   * @param {import('./tree.js').Tree} tree
   * @param {import('./window.js').WindowManager} extWm
   */
  constructor(tree, extWm) {
    super();
    this._tree = tree;
    this._extWm = extWm;
  }

  /**
   * Add a workspace to the tree structure
   * @param {number} wsIndex - Workspace index
   * @returns {boolean} True if workspace was added, false if it already exists
   */
  addWorkspace(wsIndex) {
    let wsManager = global.display.get_workspace_manager();
    let workspaceNodeValue = `ws${wsIndex}`;

    let existingWsNode = this._tree.findNode(workspaceNodeValue);
    if (existingWsNode) {
      return false;
    }

    let newWsNode = this._tree.createNode(
      this._tree.nodeValue,
      NODE_TYPES.WORKSPACE,
      workspaceNodeValue
    );

    let workspace = wsManager.get_workspace_by_index(wsIndex);
    newWsNode.layout = LAYOUT_TYPES.HSPLIT;
    newWsNode.actorBin = new St.Bin({ style_class: "workspace-actor-bg" });

    if (!global.window_group.contains(newWsNode.actorBin))
      global.window_group.add_child(newWsNode.actorBin);

    this.bindWorkspaceSignals(workspace);
    this._tree.addMonitor(wsIndex);

    return true;
  }

  /**
   * Remove a workspace from the tree structure
   * @param {number} wsIndex - Workspace index
   * @returns {boolean} True if workspace was removed, false if it didn't exist
   */
  removeWorkspace(wsIndex) {
    let workspaceNodeData = `ws${wsIndex}`;
    let existingWsNode = this._tree.findNode(workspaceNodeData);
    if (!existingWsNode) {
      return false;
    }

    // forge-98sa: addMonitor parents one St.Bin per monitor directly into
    // window_group (not under the workspace bin), so detaching only the workspace
    // bin leaks every monitor bin on each dynamic-workspace removal. Tear down the
    // workspace bin and all of this workspace's monitor bins together, mirroring
    // the contains()-guarded teardown in Tree._removeScaffoldBins. Resolve the
    // monitor bins before removeChild detaches the subtree.
    const scaffoldBins = [
      existingWsNode.actorBin,
      ...existingWsNode.getNodeByType(NODE_TYPES.MONITOR).map((monNode) => monNode.actorBin),
    ];
    for (const bin of scaffoldBins) {
      if (!bin) continue;
      if (global.window_group.contains(bin)) global.window_group.remove_child(bin);
      if (bin.destroy) bin.destroy();
    }

    // forge-21xq: a STACKED/TABBED CON in this subtree owns a decoration
    // St.BoxLayout parented straight into window_group, and removeChild only
    // tears down the decoration of the node handed to it (the WORKSPACE node,
    // always HSPLIT). Once the subtree is spliced the CON is unreachable, so
    // updateDecorationLayout can no longer hide it and cleanTree can no longer
    // collect it — it stays parented, and stays drawn if the last render showed
    // it. _destroyDecoration already does the guarded remove + child-tab reset.
    for (const conNode of existingWsNode.getNodeByType(NODE_TYPES.CON)) {
      conNode._destroyDecoration();
    }

    this._tree.removeChild(existingWsNode);

    this.unbindWorkspaceSignals(wsIndex);

    return true;
  }

  /**
   * Bind signals to a workspace for window tracking
   * @param {Meta.Workspace} metaWorkspace - The workspace to bind signals to
   */
  bindWorkspaceSignals(metaWorkspace) {
    if (!metaWorkspace) return;

    // Check if workspace supports signal connection (may be missing in tests)
    if (typeof metaWorkspace.connect !== "function") return;

    const wsIndex = typeof metaWorkspace.index === "function" ? metaWorkspace.index() : -1;

    if (wsIndex >= 0 && this._workspaceSignals.has(wsIndex)) {
      return;
    }

    const signals = [
      metaWorkspace.connect("window-added", (_, metaWindow) => {
        // forge-wqlx: queue every window added during the debounce. The single
        // shared timer id otherwise coalesced a burst (session restore, multi-
        // window apps) and re-homed only the first window, dropping the rest on
        // the multi-monitor fast-open path.
        if (!this._extWm._wsWindowAddQueue) {
          this._extWm._wsWindowAddQueue = new Set();
        }
        this._extWm._wsWindowAddQueue.add(metaWindow);
        if (!this._extWm._wsWindowAddSrcId) {
          this._extWm._wsWindowAddSrcId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            const queue = this._extWm._wsWindowAddQueue;
            this._extWm._wsWindowAddQueue = null;
            // Reset in finally: a skipped reset would wedge this guard for the
            // whole session (same class as the forge-cuv renderTree fix).
            try {
              for (const metaWindow of queue) {
                // Isolate each window: one destroyed within the debounce throws
                // on the finalized wrapper, but must not strand its siblings.
                try {
                  this._extWm.updateMetaWorkspaceMonitor(
                    "window-added",
                    metaWindow.get_monitor(),
                    metaWindow
                  );
                } catch (e) {
                  Logger.debug(`window-added re-home skipped (finalized window): ${e}`);
                }
              }
            } finally {
              this._extWm._wsWindowAddSrcId = 0;
            }
            return false;
          });
        }
      }),
    ];

    if (wsIndex >= 0) {
      // forge-gw2c: store the workspace OBJECT with its signal ids. Disconnect
      // must target the object the ids were connected on — after a reorder,
      // re-resolving by index would hit (and strand) a different workspace.
      this._workspaceSignals.set(wsIndex, { workspace: metaWorkspace, signals });
    }
  }

  /**
   * Unbind signals from a workspace
   * @param {number} wsIndex - Workspace index
   */
  unbindWorkspaceSignals(wsIndex) {
    const entry = this._workspaceSignals.get(wsIndex);
    if (!entry) return;

    // forge-gw2c: disconnect from the STORED object, not a get_workspace_by_index
    // re-resolution — the two diverge after a reorder, which is exactly when a
    // re-resolved disconnect strands a survivor's handler / leaks the real one.
    const { workspace, signals } = entry;
    try {
      if (workspace && typeof workspace.disconnect === "function") {
        signals.forEach((signalId) => {
          try {
            workspace.disconnect(signalId);
          } catch (e) {
            // Signal may already be disconnected
          }
        });
      }
    } catch (e) {
      Logger.debug(`Error unbinding workspace signals for ws${wsIndex}: ${e}`);
    }

    this._workspaceSignals.delete(wsIndex);
  }

  /**
   * Internal method to renumber workspace and monitor nodes.
   * @param {Object} opts
   * @param {function(number): boolean} opts.shouldRenumber - Predicate for which indices to renumber
   * @param {function(Object, Object): number} opts.compareFn - Sort comparator for processing order
   * @param {function(number): number} opts.newIndex - Maps old index to new index
   */
  _renumberWorkspaces({ shouldRenumber, compareFn, newIndex }) {
    const workspaceNodes = this._tree.getNodeByType(NODE_TYPES.WORKSPACE);
    if (!workspaceNodes || workspaceNodes.length === 0) return;

    const toRenumber = [];
    for (const wsNode of workspaceNodes) {
      const wsVal = wsNode.nodeValue;
      if (typeof wsVal !== "string" || !wsVal.startsWith("ws")) continue;
      const idx = parseInt(wsVal.slice(2));
      if (isNaN(idx) || !shouldRenumber(idx)) continue;
      toRenumber.push({ node: wsNode, oldIndex: idx });
    }

    toRenumber.sort(compareFn);

    // forge-2jxz: collect the signal-map rekeys and apply them in two phases
    // (delete every source key, then set every target key) AFTER the node pass,
    // making the rekey independent of processing order so it can never
    // overwrite a live signal array.
    const signalMoves = [];
    for (const { node: wsNode, oldIndex } of toRenumber) {
      const idx = newIndex(oldIndex);

      wsNode.nodeValue = `ws${idx}`;

      const monitorNodes = wsNode.getNodeByType(NODE_TYPES.MONITOR);
      if (monitorNodes) {
        for (const monNode of monitorNodes) {
          const moIdx = Utils.monitorIndex(monNode.nodeValue);
          if (moIdx >= 0) {
            monNode.nodeValue = Utils.createMonitorWorkspaceId(moIdx, idx);
          }
        }
      }

      if (this._workspaceSignals.has(oldIndex)) {
        // Move the whole {workspace, signals} entry — the object is unchanged by
        // an add/remove renumber, only its index shifts (forge-gw2c).
        signalMoves.push({ oldIndex, idx, entry: this._workspaceSignals.get(oldIndex) });
      }
    }

    for (const { oldIndex } of signalMoves) {
      this._workspaceSignals.delete(oldIndex);
    }
    for (const { idx, entry } of signalMoves) {
      this._workspaceSignals.set(idx, entry);
    }
  }

  /**
   * Renumber workspace nodes after a workspace is removed.
   * @param {number} removedIndex - The index of the workspace that was removed
   */
  renumberWorkspacesAfterRemoval(removedIndex) {
    this._renumberWorkspaces({
      shouldRenumber: (idx) => idx > removedIndex,
      compareFn: (a, b) => a.oldIndex - b.oldIndex,
      newIndex: (oldIndex) => oldIndex - 1,
    });
  }

  /**
   * Renumber workspace nodes after a workspace is added at a non-end position.
   * @param {number} insertedIndex - The index where the new workspace will be inserted
   */
  renumberWorkspacesAfterAddition(insertedIndex) {
    this._renumberWorkspaces({
      shouldRenumber: (idx) => idx >= insertedIndex,
      compareFn: (a, b) => b.oldIndex - a.oldIndex,
      newIndex: (oldIndex) => oldIndex + 1,
    });
  }

  /**
   * Clean up all workspace signals
   */
  destroy() {
    for (const wsIndex of this._workspaceSignals.keys()) {
      this.unbindWorkspaceSignals(wsIndex);
    }
    this._workspaceSignals.clear();
  }
}
