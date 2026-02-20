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
              metaWindow
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
   * Renumber workspace nodes after a workspace is removed.
   * Decrements the index of all workspace and monitor nodes with index > removedIndex.
   * Processes in ascending order (safe because the removed index slot is free).
   * @param {number} removedIndex - The index of the workspace that was removed
   */
  renumberWorkspacesAfterRemoval(removedIndex) {
    const workspaceNodes = this._tree.getNodeByType(NODE_TYPES.WORKSPACE);
    if (!workspaceNodes || workspaceNodes.length === 0) return;

    // Collect workspace nodes that need renumbering (index > removedIndex)
    const toRenumber = [];
    for (const wsNode of workspaceNodes) {
      const wsVal = wsNode.nodeValue;
      if (typeof wsVal !== "string" || !wsVal.startsWith("ws")) continue;
      const idx = parseInt(wsVal.slice(2));
      if (isNaN(idx) || idx <= removedIndex) continue;
      toRenumber.push({ node: wsNode, oldIndex: idx });
    }

    // Sort ascending so we fill the gap from lowest to highest
    toRenumber.sort((a, b) => a.oldIndex - b.oldIndex);

    for (const { node: wsNode, oldIndex } of toRenumber) {
      const newIndex = oldIndex - 1;

      // Rename workspace node
      wsNode.nodeValue = `ws${newIndex}`;

      // Rename all monitor children
      const monitorNodes = wsNode.getNodeByType(NODE_TYPES.MONITOR);
      if (monitorNodes) {
        for (const monNode of monitorNodes) {
          const moIdx = Utils.monitorIndex(monNode.nodeValue);
          if (moIdx >= 0) {
            monNode.nodeValue = Utils.createMonitorWorkspaceId(moIdx, newIndex);
          }
        }
      }

      // Shift the workspace signals map key
      if (this._workspaceSignals.has(oldIndex)) {
        const signals = this._workspaceSignals.get(oldIndex);
        this._workspaceSignals.delete(oldIndex);
        this._workspaceSignals.set(newIndex, signals);
      }
    }
  }

  /**
   * Renumber workspace nodes after a workspace is added at a non-end position.
   * Increments the index of all workspace and monitor nodes with index >= insertedIndex.
   * Processes in descending order to avoid collisions.
   * @param {number} insertedIndex - The index where the new workspace will be inserted
   */
  renumberWorkspacesAfterAddition(insertedIndex) {
    const workspaceNodes = this._tree.getNodeByType(NODE_TYPES.WORKSPACE);
    if (!workspaceNodes || workspaceNodes.length === 0) return;

    // Collect workspace nodes that need renumbering (index >= insertedIndex)
    const toRenumber = [];
    for (const wsNode of workspaceNodes) {
      const wsVal = wsNode.nodeValue;
      if (typeof wsVal !== "string" || !wsVal.startsWith("ws")) continue;
      const idx = parseInt(wsVal.slice(2));
      if (isNaN(idx) || idx < insertedIndex) continue;
      toRenumber.push({ node: wsNode, oldIndex: idx });
    }

    // Sort descending to avoid collisions (rename highest first)
    toRenumber.sort((a, b) => b.oldIndex - a.oldIndex);

    for (const { node: wsNode, oldIndex } of toRenumber) {
      const newIndex = oldIndex + 1;

      // Rename workspace node
      wsNode.nodeValue = `ws${newIndex}`;

      // Rename all monitor children
      const monitorNodes = wsNode.getNodeByType(NODE_TYPES.MONITOR);
      if (monitorNodes) {
        for (const monNode of monitorNodes) {
          const moIdx = Utils.monitorIndex(monNode.nodeValue);
          if (moIdx >= 0) {
            monNode.nodeValue = Utils.createMonitorWorkspaceId(moIdx, newIndex);
          }
        }
      }

      // Shift the workspace signals map key
      if (this._workspaceSignals.has(oldIndex)) {
        const signals = this._workspaceSignals.get(oldIndex);
        this._workspaceSignals.delete(oldIndex);
        this._workspaceSignals.set(newIndex, signals);
      }
    }
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
