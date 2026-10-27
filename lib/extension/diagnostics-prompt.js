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
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

// Gnome Shell imports
import * as Dialog from "resource:///org/gnome/shell/ui/dialog.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

/** Asked a little after login, once the session has settled */
const ASK_DELAY_S = 10;

/**
 * Ask once whether to turn on the diagnostic log. The answer, either way, is
 * kept in `diagnostic-log-asked`; closing the dialog counts as "Not now".
 */
export class DiagnosticsPrompt {
  constructor(settings) {
    this.settings = settings;
    this._askId = 0;
    this._dialog = null;
  }

  schedule() {
    if (this._askId || this.settings.get_boolean("diagnostic-log-asked")) return;
    this._askId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, ASK_DELAY_S, () => {
      this._askId = 0;
      this._show();
      return GLib.SOURCE_REMOVE;
    });
  }

  destroy() {
    if (this._askId) GLib.Source.remove(this._askId);
    this._askId = 0;
    this._dialog?.destroy();
    this._dialog = null;
  }

  _show() {
    if (this._dialog || this.settings.get_boolean("diagnostic-log-asked")) return;
    if (Main.sessionMode.isLocked) return;
    const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true });
    dialog.contentLayout.add_child(
      new Dialog.MessageDialogContent({
        title: _("Help make Forge better"),
        description: _(
          "When a window doesn't behave as you expect, it is hard to tell a bug from a " +
            "different setting. With the diagnostic log on, Forge notes your last actions " +
            "(shortcuts, drags and which apps were on screen), without window titles or " +
            "content. The log stays on your computer. It only leaves it if you click " +
            "“Report a problem” in Forge's settings, and you see everything before sending."
        ),
      })
    );
    const answer = (enabled) => {
      this.settings.set_boolean("diagnostic-log-asked", true);
      if (enabled) this.settings.set_boolean("diagnostic-log-enabled", true);
      dialog.close(global.get_current_time());
    };
    dialog.setButtons([
      { label: _("Not now"), action: () => answer(false), key: Clutter.KEY_Escape },
      { label: _("Turn on log"), action: () => answer(true) },
    ]);
    this._closedId = dialog.connect("closed", () => {
      this.settings.set_boolean("diagnostic-log-asked", true);
      this._dialog = null;
    });
    this._dialog = dialog;
    dialog.open(global.get_current_time(), true);
  }
}
