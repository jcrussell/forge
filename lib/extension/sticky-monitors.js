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

/**
 * @typedef {Object} MonitorHome
 * @property {number} monitor - Monitor index of the mo{m}ws{n} node.
 * @property {number} ws - Workspace index of the mo{m}ws{n} node.
 * @property {number} windows - Number of WINDOW nodes beneath it.
 */

/**
 * @typedef {Object} StickyMove
 * @property {number} monitor
 * @property {number} fromWs
 * @property {number} toWs
 * @property {boolean} transplant - true: hand the whole sub-tree (layout included)
 *   to the empty target; false: append its children to a target that already
 *   holds windows.
 */

/**
 * Under workspaces-only-on-primary, Mutter makes every window on a non-primary
 * monitor implicitly sticky: get_workspace() reports the ACTIVE workspace, and no
 * workspace-changed fires when the active workspace switches. The tree keys monitor
 * nodes by workspace (mo{m}ws{n}), so those windows stay homed under whichever
 * workspace was active when they were placed — and directional focus/move, which
 * resolve mo{m}ws{active}, find an empty node.
 *
 * Decide which non-primary monitor sub-trees must follow the active workspace. Pure
 * over plain values so every flow is unit-testable.
 *
 * @param {Object} input
 * @param {number} input.activeWs
 * @param {number} input.primaryMonitor
 * @param {boolean} input.onlyOnPrimary
 * @param {MonitorHome[]} input.homes
 * @returns {StickyMove[]}
 */
export function planStickyMonitorRehome({ activeWs, primaryMonitor, onlyOnPrimary, homes }) {
  if (!onlyOnPrimary || activeWs < 0) return [];

  /** @type {Map<number, MonitorHome[]>} */
  const byMonitor = new Map();
  for (const home of homes) {
    if (home.monitor === primaryMonitor || home.windows <= 0) continue;
    const list = byMonitor.get(home.monitor) ?? [];
    list.push(home);
    byMonitor.set(home.monitor, list);
  }

  const moves = [];
  const ordered = [...byMonitor.entries()].sort(([a], [b]) => a - b);
  for (const [monitor, monitorHomes] of ordered) {
    let targetHoldsWindows = monitorHomes.some((h) => h.ws === activeWs);
    // Largest stray sub-tree first so it keeps its layout; ties by lower index.
    const strays = monitorHomes
      .filter((h) => h.ws !== activeWs)
      .sort((a, b) => b.windows - a.windows || a.ws - b.ws);
    for (const stray of strays) {
      moves.push({ monitor, fromWs: stray.ws, toWs: activeWs, transplant: !targetHoldsWindows });
      targetHoldsWindows = true;
    }
  }
  return moves;
}
