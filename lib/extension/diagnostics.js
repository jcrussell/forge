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
import Gio from "gi://Gio";

// Gnome Shell imports
import { PACKAGE_VERSION } from "resource:///org/gnome/shell/misc/config.js";

// Shared state
import { Logger } from "../shared/logger.js";
import {
  LOG_FILE,
  STATE_FILE,
  SETTINGS_COMMANDS,
  RingLog,
  describeAction,
  findLayoutProblems,
  formatEntry,
  noChangeReason,
  windowLabel,
} from "../shared/diagnostics.js";

// App imports
import { NODE_TYPES, LAYOUT_TYPES } from "./tree.js";
import * as Utils from "./utils.js";
import * as Compat from "./compat.js";

/** How long after an action its result is read: past a responsive app's redraw */
const CHECK_DELAY_MS = 700;
/** Repeats of one action within this time are one log line ("×N"), e.g. a held key */
const REPEAT_MS = 1500;
/** Writes to disk are batched */
const FLUSH_DELAY_MS = 2000;

/**
 * The diagnostic log (off unless the user turns it on): the last actions —
 * shortcuts, drags, windows opening and closing — each with what came of it,
 * and a line whenever tiled windows overlap or leave the screen. Kept on this
 * computer only; prefs turns it into a report the user reviews before sending.
 */
export class Diagnostics {
  /** @param {any} ext the extension */
  constructor(ext) {
    this.ext = ext;
    this.settings = ext.settings;
    this.ring = new RingLog();
    /** @type {Set<number>} */
    this._timers = new Set();
    this._flushId = 0;
    this._lastProblems = "";
    this._grab = null;
    this._inCommand = 0;
    this.dir = GLib.build_filenamev([GLib.get_user_state_dir(), "forge"]);
    this._settingsId = this.settings.connect("changed::diagnostic-log-enabled", () =>
      this._onEnabledChanged()
    );
  }

  get active() {
    return this.settings.get_boolean("diagnostic-log-enabled");
  }

  get wm() {
    return this.ext.extWm;
  }

  destroy() {
    if (this._settingsId) this.settings.disconnect(this._settingsId);
    this._settingsId = 0;
    this._timers.forEach((id) => GLib.Source.remove(id));
    this._timers.clear();
    if (this._flushId) GLib.Source.remove(this._flushId);
    this._flushId = 0;
    if (this.active && this.ring.entries.length > 0) this.flush();
  }

  _onEnabledChanged() {
    if (this.active) {
      this.record({ source: "forge", action: "log turned on", outcome: "" });
      return;
    }
    // Turning it off also forgets it
    this.ring.clear();
    for (const name of [LOG_FILE, STATE_FILE]) {
      try {
        Gio.File.new_for_path(GLib.build_filenamev([this.dir, name])).delete(null);
      } catch (e) {
        // Not there
      }
    }
  }

  _later(ms, fn) {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      this._timers.delete(id);
      try {
        fn();
      } catch (e) {
        Logger.warn(`diagnostics: ${e}`);
      }
      return GLib.SOURCE_REMOVE;
    });
    this._timers.add(id);
  }

  /**
   * Add a line, or count a repeat of the last one (same action on the same
   * window soon after). Returns the entry so its outcome can be filled in later.
   * @param {{source: string, action: string, target?: string, outcome?: string}} entry
   */
  record({ source, action, target = "", outcome = undefined }) {
    const now = new Date();
    const last = this.ring.entries[this.ring.entries.length - 1];
    if (
      last &&
      last.source === source &&
      last.action === action &&
      last.target === target &&
      now.getTime() - last.time.getTime() < REPEAT_MS &&
      source !== "check"
    ) {
      last.count = (last.count ?? 1) + 1;
      last.time = now;
      if (outcome !== undefined) last.outcome = outcome;
      this._scheduleFlush();
      return last;
    }
    const entry = this.ring.push({ time: now, source, action, target, outcome });
    this._scheduleFlush();
    return entry;
  }

  /** Run a command, logging what it was, on which window, and what came of it */
  runCommand(action, run) {
    if (!this.active) return run();
    const focus = this._focusWindow();
    const state = this._windowState(focus);
    const entry = this.record({
      source: "key",
      action: describeAction(action),
      target: focus ? `${this._label(focus)} (${state})` : "",
    });
    const before = this._signature();
    this._inCommand++;
    try {
      run();
    } catch (e) {
      entry.outcome = `ERROR ${e}`;
      throw e;
    } finally {
      this._inCommand--;
    }
    if (SETTINGS_COMMANDS.has(action.name)) {
      entry.outcome = "done";
      return undefined;
    }
    const tilingEnabled = this.settings.get_boolean("tiling-mode-enabled");
    this._later(CHECK_DELAY_MS, () => {
      if (this._signature() !== before) {
        entry.outcome = "ok";
      } else {
        const reason = noChangeReason({
          tilingEnabled,
          state: focus ? state : "no window focused",
        });
        entry.outcome = reason ? `no change: ${reason}` : "no change";
      }
      this._checkLayout();
    });
    return undefined;
  }

  /** A pointer drag of a window's title (move) or edge (resize) starts */
  grabBegin(metaWindow, grabOp) {
    // A keyboard resize starts a grab from inside its command, already logged
    if (!this.active || this._inCommand > 0 || !metaWindow) {
      this._grab = null;
      return;
    }
    this._grab = {
      metaWindow,
      // A title drag is WINDOW_BASE, which grabMode() doesn't count as MOVING
      moving: Utils.grabMode(grabOp) !== "RESIZING",
      state: this._windowState(metaWindow),
      before: this._signature(),
    };
  }

  /** The drag ends: log it, and once the windows have settled, its outcome */
  grabEnd() {
    const grab = this._grab;
    this._grab = null;
    if (!grab || !this.active || !Utils.isWindowAlive(grab.metaWindow)) return;
    let note = "";
    if (grab.moving && !grab.state.startsWith("floating")) {
      const mod = this.ext.kbdSettings?.get_string("mod-mask-mouse-tile") ?? "None";
      if (mod !== "None" && !this.wm?.allowDragDropTile())
        note = `dropped without ${mod} held, so it wasn't retiled`;
    }
    const entry = this.record({
      source: "mouse",
      action: grab.moving ? "drag title" : "drag edge",
      target: `${this._label(grab.metaWindow)} (${grab.state})`,
    });
    this._later(CHECK_DELAY_MS, () => {
      const changed = this._signature() !== grab.before;
      entry.outcome = changed ? "ok" : `no change${note ? `: ${note}` : ""}`;
      this._checkLayout();
    });
  }

  windowOpened(metaWindow) {
    if (!this.active || !Utils.isWindowAlive(metaWindow)) return;
    const entry = this.record({
      source: "window",
      action: "open",
      target: this._label(metaWindow),
    });
    this._later(CHECK_DELAY_MS, () => {
      entry.outcome = Utils.isWindowAlive(metaWindow) ? this._windowState(metaWindow) : "closed";
      this._checkLayout();
    });
  }

  windowClosed(metaWindow) {
    if (!this.active || !metaWindow) return;
    // A closed window may already be finalized: only what was read before
    const label = metaWindow._forgeDiagLabel ?? "a window";
    this.record({ source: "window", action: "close", target: label, outcome: "" });
    this._later(CHECK_DELAY_MS, () => this._checkLayout());
  }

  _focusWindow() {
    const focus = global.display.get_focus_window();
    return Utils.isWindowAlive(focus) ? focus : null;
  }

  _label(metaWindow) {
    const label = windowLabel(metaWindow.get_wm_class(), metaWindow.get_id());
    metaWindow._forgeDiagLabel = label;
    return label;
  }

  /** What the window is to Forge, in the words a report needs */
  _windowState(metaWindow) {
    if (!metaWindow) return "no window focused";
    const wm = this.wm;
    if (metaWindow.is_fullscreen()) return "fullscreen";
    if (Compat.isMaximized(metaWindow)) return "maximized";
    if (metaWindow.minimized) return "minimized";
    const node = wm?.findNodeWindow(metaWindow);
    if (!node) return "not managed by Forge";
    if (node.isFloat()) {
      if (wm._isDialogLike(metaWindow)) return "floating: dialog";
      if (metaWindow.is_above()) return "floating: always on top";
      if (!wm.isActiveWindowWorkspaceTiled(metaWindow)) return "floating: workspace not tiled";
      if (!wm.isActiveWindowMonitorTiled(metaWindow)) return "floating: monitor not tiled";
      if (!metaWindow.allows_resize()) return "floating: fixed size";
      if (wm._matchesFloatOverride(metaWindow)) return "floating: float rule or toggle";
      return "floating";
    }
    return `tiled in ${node.parentNode?.layout ?? "?"}`;
  }

  /** Window nodes on the active workspace, not minimized */
  _activeNodes() {
    const ws = global.workspace_manager.get_active_workspace();
    const nodes = this.wm?.tree?.getNodeByType(NODE_TYPES.WINDOW) ?? [];
    return nodes.filter(
      (n) =>
        Utils.isWindowAlive(n.nodeValue) &&
        n.nodeValue.get_workspace() === ws &&
        !n.nodeValue.minimized
    );
  }

  /** Changes whenever focus, the layout or any window's frame changes */
  _signature() {
    const focus = this._focusWindow();
    const frames = this._activeNodes().map((n) => {
      const f = n.nodeValue.get_frame_rect();
      return `${n.nodeValue.get_id()}:${n.mode}:${f.x},${f.y},${f.width},${f.height}`;
    });
    return `${focus?.get_id() ?? 0}|${this.treeText()}|${frames.join(";")}`;
  }

  /** The active workspace's layout, e.g. "monitor 0: HSPLIT[firefox#12 60%, kitty#3 40%]" */
  treeText() {
    const wsIndex = global.workspace_manager.get_active_workspace_index();
    const wsNode = this.wm?.tree?.findNode(`ws${wsIndex}`);
    if (!wsNode) return "(no layout)";
    const fmt = (n) => {
      const share = this._shareText(n);
      if (n.nodeType === NODE_TYPES.WINDOW) {
        if (!Utils.isWindowAlive(n.nodeValue)) return "(closed)";
        const flags = [];
        if (n.isFloat()) flags.push("float");
        if (n.nodeValue.minimized) flags.push("min");
        if (Compat.isMaximized(n.nodeValue)) flags.push("max");
        return `${this._label(n.nodeValue)}${flags.length ? `(${flags.join(",")})` : ""}${share}`;
      }
      return `${n.layout}[${n.childNodes.map(fmt).join(", ")}]${share}`;
    };
    return wsNode.childNodes
      .filter((mon) => mon.nodeType === NODE_TYPES.MONITOR)
      .map((mon) => `monitor ${mon.nodeValue.replace(/ws\d+$/, "").replace("mo", "")}: ${fmt(mon)}`)
      .join("\n");
  }

  /**
   * " 40%": the node's share of its split as laid out (a 0 percent is an equal
   * share, and the tiled siblings' percents are scaled to fill), or "" outside a split.
   */
  _shareText(node) {
    const parent = node.parentNode;
    const split = parent?.layout === LAYOUT_TYPES.HSPLIT || parent?.layout === LAYOUT_TYPES.VSPLIT;
    if (!split || node.nodeType === NODE_TYPES.MONITOR) return "";
    const tiled = this.wm?.tree?.getTiledChildren(parent.childNodes) ?? [];
    if (!tiled.includes(node)) return "";
    const percent = (n) => (n.percent > 0 ? n.percent : 1 / tiled.length);
    const total = tiled.reduce((sum, n) => sum + percent(n), 0);
    return ` ${Math.round((percent(node) / total) * 100)}%`;
  }

  /** Log tiled windows that overlap or leave the screen, once per new set of problems */
  _checkLayout() {
    const ws = global.workspace_manager.get_active_workspace();
    /** @type {Record<number, any>} */
    const workAreas = {};
    const windows = [];
    for (const n of this._activeNodes()) {
      const mw = n.nodeValue;
      if (n.mode !== "TILE" || Compat.isMaximized(mw) || mw.is_fullscreen()) continue;
      const monitor = mw.get_monitor();
      workAreas[monitor] ??= ws.get_work_area_for_monitor(monitor);
      let group = null;
      for (let p = n.parentNode; p; p = p.parentNode) if (p.isStackedOrTabbed?.()) group = p;
      const f = mw.get_frame_rect();
      windows.push({
        label: this._label(mw),
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        monitor,
        group,
      });
    }
    const problems = findLayoutProblems(windows, workAreas);
    const key = problems.join("; ");
    if (key === this._lastProblems) return;
    const hadProblems = this._lastProblems !== "";
    this._lastProblems = key;
    if (problems.length === 0) {
      if (hadProblems) this.record({ source: "check", action: "layout ok again", outcome: "" });
      return;
    }
    this.record({
      source: "check",
      action: "BUG? layout",
      outcome: `${key}\n           layout: ${this.treeText().replace(
        /\n/g,
        "\n                   "
      )}`,
    });
  }

  _scheduleFlush() {
    if (this._flushId) return;
    this._flushId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, FLUSH_DELAY_MS, () => {
      this._flushId = 0;
      this.flush();
      return GLib.SOURCE_REMOVE;
    });
  }

  /** The log as text, oldest first */
  logText() {
    return this.ring.entries
      .map((e) => {
        const line = formatEntry({
          ...e,
          action: e.count > 1 ? `${e.action} ×${e.count}` : e.action,
        });
        return line;
      })
      .join("\n");
  }

  /** Screen and windows now: monitors, workspace, layout */
  stateText() {
    const display = global.display;
    const forge = this.ext.metadata?.["version-name"] ?? "?";
    const lines = [`GNOME Shell ${PACKAGE_VERSION}, Forge ${forge}`];
    for (let i = 0; i < display.get_n_monitors(); i++) {
      const g = display.get_monitor_geometry(i);
      lines.push(
        `monitor ${i}: ${g.width}x${g.height} at ${g.x},${g.y}, scale ${display.get_monitor_scale(
          i
        )}`
      );
    }
    const wsm = global.workspace_manager;
    lines.push(`workspace ${wsm.get_active_workspace_index() + 1} of ${wsm.get_n_workspaces()}`);
    lines.push(`tiling ${this.settings.get_boolean("tiling-mode-enabled") ? "on" : "off"}`);
    lines.push(this.treeText());
    return lines.join("\n");
  }

  flush() {
    try {
      GLib.mkdir_with_parents(this.dir, 0o700);
      const write = (name, text) =>
        GLib.file_set_contents(
          GLib.build_filenamev([this.dir, name]),
          new TextEncoder().encode(`${text}\n`)
        );
      write(LOG_FILE, this.logText());
      write(STATE_FILE, this.stateText());
    } catch (e) {
      Logger.warn(`diagnostics: can't write the log: ${e}`);
    }
  }
}
