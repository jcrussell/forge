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
      workspaceNodeValue,
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

    if (global.window_group.contains(existingWsNode.actorBin))
      global.window_group.remove_child(existingWsNode.actorBin);

    this._tree.removeChild(existingWsNode);

    // Clean up workspace signals
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

    // Don't bind if already bound (check workspace property for backwards compat)
    if (metaWorkspace.workspaceSignals) return;

    const wsIndex = typeof metaWorkspace.index === "function" ? metaWorkspace.index() : -1;

    // Don't bind if already tracked internally
    if (wsIndex >= 0 && this._workspaceSignals.has(wsIndex)) {
      return;
    }

    const signals = [
      metaWorkspace.connect("window-added", (_, metaWindow) => {
        if (!this._extWm._wsWindowAddSrcId) {
          this._extWm._wsWindowAddSrcId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._extWm.updateMetaWorkspaceMonitor(
              "window-added",
              metaWindow.get_monitor(),
              metaWindow,
            );
            this._extWm._wsWindowAddSrcId = 0;
            return false;
          });
        }
      }),
    ];

    if (wsIndex >= 0) {
      this._workspaceSignals.set(wsIndex, signals);
    }

    // Also store on metaWorkspace for backwards compatibility
    metaWorkspace.workspaceSignals = signals;
  }

  /**
   * Unbind signals from a workspace
   * @param {number} wsIndex - Workspace index
   */
  unbindWorkspaceSignals(wsIndex) {
    const signals = this._workspaceSignals.get(wsIndex);
    if (!signals) return;

    try {
      const wsManager = global.display.get_workspace_manager();
      const workspace = wsManager.get_workspace_by_index(wsIndex);
      if (workspace) {
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
   * Clean up all workspace signals
   */
  destroy() {
    for (const wsIndex of this._workspaceSignals.keys()) {
      this.unbindWorkspaceSignals(wsIndex);
    }
    this._workspaceSignals.clear();
  }
}
