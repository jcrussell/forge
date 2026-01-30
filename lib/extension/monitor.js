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
import GObject from "gi://GObject";
import St from "gi://St";

// App imports
import { NODE_TYPES } from "./tree.js";
import * as Utils from "./utils.js";

/**
 * MonitorManager handles monitor-related operations for the tiling tree.
 * Extracted from tree.js to consolidate monitor logic.
 */
export class MonitorManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /** @type {import('./tree.js').Tree} */
  _tree;

  /** @type {import('./window.js').WindowManager} */
  _extWm;

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
   * Add monitor nodes for a workspace
   * @param {number} wsIndex - Workspace index
   */
  addMonitor(wsIndex) {
    let monitors = global.display.get_n_monitors();
    for (let mi = 0; mi < monitors; mi++) {
      let monitorWsNode = this._tree.createNode(
        `ws${wsIndex}`,
        NODE_TYPES.MONITOR,
        Utils.createMonitorWorkspaceId(mi, wsIndex)
      );
      monitorWsNode.layout = this._extWm.determineSplitLayout();
      monitorWsNode.actorBin = new St.Bin();
      if (!global.window_group.contains(monitorWsNode.actorBin))
        global.window_group.add_child(monitorWsNode.actorBin);
    }
  }

  /**
   * Get the number of monitors
   * @returns {number} Number of monitors
   */
  getMonitorCount() {
    return global.display.get_n_monitors();
  }

  /**
   * Get monitor node for a workspace and monitor index
   * @param {number} wsIndex - Workspace index
   * @param {number} monitorIndex - Monitor index
   * @returns {import('./tree.js').Node|null} Monitor node or null
   */
  getMonitorNode(wsIndex, monitorIndex) {
    return this._tree.findNode(Utils.createMonitorWorkspaceId(monitorIndex, wsIndex));
  }
}
