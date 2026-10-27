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

// The diagnostic log: what the user did last and what Forge made of it, so a
// report tells a bug from a setting or a floating window. Shared by the
// extension (which writes it) and prefs (which builds the report); no GNOME
// imports here, so both and the tests can load it.

/** How many actions the log keeps */
export const MAX_ENTRIES = 100;

/** Files under $XDG_STATE_HOME/forge/ */
export const LOG_FILE = "diagnostic.log";
export const STATE_FILE = "diagnostic-state.txt";

/** Where "Report a problem" opens a new issue */
export const ISSUE_URL = "https://github.com/luisgneiting/Zforge/issues/new";

/** GitHub cuts long URLs: past this, the report goes by the clipboard only */
const MAX_ISSUE_URL_LENGTH = 7500;

/** Commands that change settings or open things, not windows: nothing to check after them */
export const SETTINGS_COMMANDS = new Set([
  "FocusBorderToggle",
  "ShowTabDecorationToggle",
  "PrefsOpen",
  "ConfigReload",
  "ConfigExport",
  "MovePointerToFocus",
]);

/** A fixed-size list that drops the oldest entry when full */
export class RingLog {
  constructor(max = MAX_ENTRIES) {
    this.max = max;
    /** @type {any[]} */
    this.entries = [];
  }

  push(entry) {
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    return entry;
  }

  clear() {
    this.entries = [];
  }
}

const pad2 = (n) => String(n).padStart(2, "0");

/** @param {Date} date */
export function formatTime(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * A command as a short readable name: "Focus Left", "Split vertical",
 * "GapSize +1", "WindowResizeRight -25".
 */
export function describeAction(action) {
  if (!action) return "?";
  let text = action.name ?? "?";
  if (action.direction) text += ` ${action.direction}`;
  if (action.orientation) text += ` ${action.orientation}`;
  if (typeof action.amount === "number" && action.name !== "SnapLayoutMove") {
    text += ` ${action.amount > 0 ? "+" : ""}${action.amount}`;
  }
  return text;
}

/**
 * How a window is named in the log: its app (wm_class) and a short id that
 * tells two windows of the same app apart. Never its title.
 */
export function windowLabel(wmClass, id) {
  const app = (wmClass || "unknown").replace(/\s+/g, "_").slice(0, 40);
  return `${app}#${id % 1000}`;
}

/**
 * One log line: "14:03:22 key    Focus Left               firefox#123 (tiled in HSPLIT)  ok"
 * @param {{time: Date, source: string, action: string, target?: string, outcome?: string}} entry
 */
export function formatEntry(entry) {
  const parts = [formatTime(entry.time), entry.source.padEnd(6), entry.action.padEnd(24)];
  parts.push((entry.target ?? "").padEnd(36));
  parts.push(entry.outcome ?? "…");
  return parts.join(" ").trimEnd();
}

/**
 * Why a command most likely changed nothing, from the state it found, or null
 * when nothing in that state stops it (e.g. focus at the edge of the screen).
 * @param {{tilingEnabled: boolean, state: string}} ctx
 */
export function noChangeReason(ctx) {
  if (!ctx.tilingEnabled) return "tiling is off (Super+W or the Tiling quick setting)";
  const state = ctx.state ?? "";
  if (state === "no window focused") return "no window was focused";
  if (state.startsWith("floating"))
    return `the window is ${state}; tiling shortcuts act on tiled windows`;
  if (state === "maximized" || state === "fullscreen")
    return `the window is ${state}; restore it first`;
  if (state === "not managed by Forge") return "Forge doesn't manage this window";
  return null;
}

/**
 * Tiled windows that overlap or leave their monitor's work area: what the user
 * sees as a broken layout. `tol` allows for gaps and rounding.
 * @param {{label: string, x: number, y: number, width: number, height: number, monitor: number, group?: any}[]} windows
 * @param {Record<number, {x: number, y: number, width: number, height: number}>} workAreas
 * @returns {string[]}
 */
export function findLayoutProblems(windows, workAreas, tol = 8) {
  const problems = [];
  for (const w of windows) {
    const area = workAreas[w.monitor];
    if (!area) continue;
    const out = Math.max(
      area.x - w.x,
      area.y - w.y,
      w.x + w.width - (area.x + area.width),
      w.y + w.height - (area.y + area.height)
    );
    if (out > tol) problems.push(`${w.label} is ${out}px off its screen`);
  }
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i];
      const b = windows[j];
      // Windows of one tabbed/stacked group share its area by design
      if (a.group && a.group === b.group) continue;
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > tol && oy > tol) problems.push(`${a.label} and ${b.label} overlap by ${ox}x${oy}px`);
    }
  }
  return problems;
}

/**
 * The report shown in prefs before it is sent anywhere.
 * @param {{forgeVersion: string, session: string, state: string, settings: string[], log: string}} parts
 */
export function buildReport({ forgeVersion, session, state, settings, log }) {
  const section = (title, body) => `## ${title}\n${body.trim() || "(none)"}\n`;
  return [
    `Forge ${forgeVersion} · session ${session}`,
    "",
    section("Screen and windows (when the last action was logged)", state),
    section("Settings changed from their defaults", settings.join("\n")),
    section(`Last actions (up to ${MAX_ENTRIES}, oldest first)`, log),
  ].join("\n");
}

/**
 * A link that opens a new GitHub issue. The report goes in the body when it
 * fits in a URL; otherwise the body asks to paste it (it is on the clipboard).
 */
export function issueUrl(base, title, report) {
  const intro = "**What did you do, and what did you expect to happen?**\n\n\n\n";
  const full = `${intro}<details><summary>Forge report</summary>\n\n\`\`\`\n${report}\n\`\`\`\n</details>\n`;
  const make = (body) =>
    `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const url = make(full);
  if (url.length <= MAX_ISSUE_URL_LENGTH) return url;
  return make(`${intro}**Forge report:** it was copied to the clipboard; paste it here.\n`);
}
