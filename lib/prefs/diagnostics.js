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
import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

// Extension imports
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Shared state
import { ISSUE_URL, LOG_FILE, STATE_FILE, buildReport, issueUrl } from "../shared/diagnostics.js";

// Prefs UI
import { SwitchRow } from "./widgets.js";

// Settings that are bookkeeping, not choices: left out of the report
const INTERNAL_KEYS = new Set([
  "css-updated",
  "css-last-update",
  "window-overrides-reload-trigger",
  "config-last-import",
  "config-last-export",
  "diagnostic-log-asked",
]);

function readStateFile(name) {
  const path = GLib.build_filenamev([GLib.get_user_state_dir(), "forge", name]);
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    return ok ? new TextDecoder().decode(bytes) : "";
  } catch (e) {
    return "";
  }
}

/** "key = value" for each setting the user changed from its default */
function changedSettings(...allSettings) {
  const lines = [];
  for (const settings of allSettings) {
    for (const key of settings.settings_schema.list_keys().sort()) {
      if (INTERNAL_KEYS.has(key)) continue;
      const value = settings.get_user_value(key);
      if (value) lines.push(`${key} = ${value.print(false)}`);
    }
  }
  return lines;
}

/** The report, from the files the extension wrote and the current settings */
export function collectReport({ settings, kbdSettings, metadata }) {
  let log = readStateFile(LOG_FILE);
  if (!settings.get_boolean("diagnostic-log-enabled"))
    log = _("(The diagnostic log is off, so there are no actions here.)");
  else if (!log.trim())
    log = _("(Nothing logged yet: the extension writes the log a few seconds after each action.)");
  return buildReport({
    forgeVersion: metadata?.["version-name"] ?? "?",
    session: GLib.getenv("XDG_SESSION_TYPE") ?? "?",
    state: readStateFile(STATE_FILE),
    settings: changedSettings(settings, kbdSettings),
    log,
  });
}

/** The window that shows the report so the user sees (and can edit) it before sending */
class ReportWindow extends Adw.Window {
  static {
    GObject.registerClass(this);
  }

  constructor({ parent, report }) {
    super({
      title: _("Report a problem"),
      transient_for: parent,
      modal: true,
      default_width: 820,
      default_height: 640,
    });
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    box.append(new Adw.HeaderBar());

    const content = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      margin_top: 12,
      margin_bottom: 12,
      margin_start: 12,
      margin_end: 12,
      vexpand: true,
    });
    content.append(
      new Gtk.Label({
        label: _(
          "This is everything the report contains. Nothing has been sent. You can edit it " +
            "here; then copy it, or open a new issue on GitHub (the report is copied too, " +
            "in case it doesn't fit in the link)."
        ),
        wrap: true,
        xalign: 0,
      })
    );
    this.buffer = new Gtk.TextBuffer({ text: report });
    const view = new Gtk.TextView({
      buffer: this.buffer,
      monospace: true,
      wrap_mode: Gtk.WrapMode.NONE,
      top_margin: 6,
      left_margin: 6,
    });
    content.append(new Gtk.ScrolledWindow({ child: view, vexpand: true, css_classes: ["card"] }));

    const buttons = new Gtk.Box({ spacing: 12, halign: Gtk.Align.END });
    const copy = new Gtk.Button({ label: _("Copy") });
    copy.connect("clicked", () => this._copy());
    const open = new Gtk.Button({
      label: _("Open GitHub issue"),
      css_classes: ["suggested-action"],
    });
    open.connect("clicked", () => {
      const text = this._copy();
      const launcher = new Gtk.UriLauncher({ uri: issueUrl(ISSUE_URL, "", text) });
      // Callback form: GJS returns a Promise only once launch is promisified
      /** @type {any} */ (launcher).launch(this, null, null);
    });
    buttons.append(copy);
    buttons.append(open);
    content.append(buttons);

    box.append(content);
    this.set_content(box);
  }

  /** @returns {string} */
  _copy() {
    const text = this.buffer.get_text(
      this.buffer.get_start_iter(),
      this.buffer.get_end_iter(),
      false
    );
    const bytes = new GLib.Bytes(new TextEncoder().encode(text ?? ""));
    this.get_clipboard().set_content(
      Gdk.ContentProvider.new_for_bytes("text/plain;charset=utf-8", bytes)
    );
    return text ?? "";
  }
}

/** The "Diagnostics" group of the Tiling page */
export function diagnosticsGroup({ settings, kbdSettings, metadata, window }) {
  const reportRow = new Adw.ActionRow({
    title: _("Report a problem"),
    subtitle: _("See what a report contains, then copy it or open an issue on GitHub"),
  });
  const reportButton = new Gtk.Button({ label: _("Report…"), valign: Gtk.Align.CENTER });
  reportButton.connect("clicked", () => {
    const report = collectReport({ settings, kbdSettings, metadata });
    new ReportWindow({ parent: window, report }).present();
  });
  reportRow.add_suffix(reportButton);
  reportRow.activatable_widget = reportButton;

  return {
    title: _("Diagnostics"),
    description: _(
      "The log keeps your last 100 actions on this computer, without window titles or " +
        "content, to tell a bug from a setting. Turning it off deletes it."
    ),
    children: [
      new SwitchRow({
        title: _("Diagnostic log"),
        subtitle: _("Note shortcuts, drags and which apps were on screen"),
        settings,
        bind: "diagnostic-log-enabled",
      }),
      reportRow,
    ],
  };
}
