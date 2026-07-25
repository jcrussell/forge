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

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "../shared/logger.js";
import * as Utils from "./utils.js";

/**
 * A Clutter.Actor with GNOME Shell's environment.js `ease()` animation helper,
 * which @girs does not model (it is monkey-patched onto the prototype at runtime).
 * @typedef {St.BoxLayout & { ease: (params: object) => void }} Easable
 */

// Category display names (translatable) keyed by their keybinding-key prefix.
// Built lazily so gettext resolves at render time rather than module load.
function categories() {
  return [
    { prefix: "window-focus", name: _("Focus") },
    { prefix: "window-swap", name: _("Swap") },
    { prefix: "window-move", name: _("Move") },
    { prefix: "window-resize", name: _("Resize") },
    { prefix: "window-snap", name: _("Snap") },
    { prefix: "window-toggle", name: _("Window Toggle") },
    { prefix: "window-gap", name: _("Gaps") },
    { prefix: "window-reset", name: _("Window Reset") },
    { prefix: "window-expand", name: _("Window Size") },
    { prefix: "window-shrink", name: _("Window Size") },
    { prefix: "window-golden", name: _("Window Size") },
    { prefix: "window-pointer", name: _("Pointer") },
    { prefix: "con-split", name: _("Split") },
    { prefix: "con-stacked", name: _("Stacked") },
    { prefix: "con-tabbed", name: _("Tabbed") },
    { prefix: "workspace", name: _("Workspace") },
    { prefix: "focus-border", name: _("Appearance") },
    { prefix: "prefs", name: _("Preferences") },
  ];
}

export class Cheatsheet extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /** @type {import('../../extension.js').default} */
  ext;

  /** @type {St.BoxLayout | null} */
  _overlay = null;

  /** @type {St.Widget | null} full-screen reactive backdrop for click-outside-to-dismiss */
  _backdrop = null;

  /** @type {boolean} */
  _visible = false;

  /** @type {number} signal id for Main.layoutManager::monitors-changed (0 = none) */
  _monitorsChangedId = 0;

  constructor(ext) {
    super();
    this.ext = ext;
    Logger.debug("created cheatsheet");
  }

  _buildOverlay() {
    if (this._overlay) {
      return;
    }

    this._overlay = new St.BoxLayout({
      style_class: "forge-cheatsheet",
      style:
        "background-color: #2d2d2d; border-radius: 16px; padding: 24px 32px; border: 1px solid #4d4d4d;",
      vertical: true,
      reactive: true,
      can_focus: true,
    });

    // Escape dismisses the sheet. grab_key_focus() (in show()) routes keys here
    // without a modal grab, so the global toggle accelerator still fires too.
    this._overlay.connect("key-press-event", (_actor, event) => {
      if (event.get_key_symbol() === Clutter.KEY_Escape) {
        this.hide();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });

    // Header row with a close button so the sheet is dismissable by mouse too.
    const headerRow = new St.BoxLayout({ x_expand: true, style: "margin-bottom: 8px;" });
    const headerSpacer = new St.Widget({ x_expand: true });
    const closeButton = new St.Button({
      style_class: "forge-cheatsheet-close",
      style: "color: #cccccc; border-radius: 6px; padding: 2px 4px;",
      can_focus: true,
      child: new St.Icon({ icon_name: "window-close-symbolic", icon_size: 16 }),
    });
    closeButton.connect("clicked", () => this.hide());
    headerRow.add_child(headerSpacer);
    headerRow.add_child(closeButton);
    this._overlay.add_child(headerRow);

    const contentBox = new St.BoxLayout({
      vertical: false,
      style: "spacing: 32px;",
    });
    this._overlay.add_child(contentBox);

    const groups = this._getGroupedKeybindings();

    // Split groups into columns for better layout
    const leftColumn = new St.BoxLayout({ vertical: true });
    const rightColumn = new St.BoxLayout({ vertical: true });
    contentBox.add_child(leftColumn);
    contentBox.add_child(rightColumn);

    let leftCount = 0;
    let rightCount = 0;

    for (const [categoryName, bindings] of groups) {
      if (bindings.length === 0) continue;

      const column = leftCount <= rightCount ? leftColumn : rightColumn;
      const count = bindings.length + 1; // +1 for header

      if (leftCount <= rightCount) {
        leftCount += count;
      } else {
        rightCount += count;
      }

      const section = this._createCategorySection(categoryName, bindings);
      column.add_child(section);
    }
  }

  _createCategorySection(categoryName, bindings) {
    const section = new St.BoxLayout({
      vertical: true,
      style: "margin-bottom: 20px;",
    });

    const headerBox = new St.BoxLayout({
      style:
        "background-color: rgba(255,255,255,0.08); border-radius: 4px; padding: 6px 10px; margin-bottom: 8px;",
      x_expand: true,
    });
    const categoryLabel = new St.Label({
      text: categoryName.toUpperCase(),
      style_class: "forge-cheatsheet-category",
      x_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
    });
    headerBox.add_child(categoryLabel);
    section.add_child(headerBox);

    for (const binding of bindings) {
      const row = new St.BoxLayout({
        style_class: "forge-cheatsheet-row",
        style: "margin-top: 4px;",
      });

      const keyLabel = new St.Label({
        text: binding.shortcut,
        style_class: "forge-cheatsheet-key",
        style: "min-width: 180px;",
      });
      row.add_child(keyLabel);

      const descLabel = new St.Label({
        text: binding.description,
        style_class: "forge-cheatsheet-desc",
      });
      row.add_child(descLabel);

      section.add_child(row);
    }

    return section;
  }

  _getGroupedKeybindings() {
    const kbdSettings = this.ext.kbdSettings;
    if (!kbdSettings) return [];
    const keys = kbdSettings.list_keys();
    const groups = new Map();

    const cats = categories();
    // Descriptions come from the keybindings schema <summary> (single source of
    // truth, also shown in dconf). Wrapped in _() so the strings — extracted into
    // the catalog from the gschema XML — are translated at render time.
    const schema = kbdSettings.settingsSchema;
    const otherName = _("Other");

    for (const key of keys) {
      // forge-u7t0: scan only string-array shortcut keys so get_strv() never trips
      // over a wrong-typed key (mod-mask-mouse-tile is "s"), which logs a GLib
      // CRITICAL per cheatsheet open. Mirrors the prefs keyboard page filter.
      if (kbdSettings.get_default_value(key)?.get_type_string() !== "as") continue;
      const shortcuts = kbdSettings.get_strv(key);
      if (!shortcuts || shortcuts.length === 0) continue;

      let categoryName = otherName;
      for (const cat of cats) {
        if (key.startsWith(cat.prefix)) {
          categoryName = cat.name;
          break;
        }
      }

      // Merge duplicate category names
      if (!groups.has(categoryName)) {
        groups.set(categoryName, []);
      }

      const shortcutStr = shortcuts.map((s) => this._formatShortcut(s)).join(", ");

      const summary = schema.get_key(key).get_summary();
      const description = summary ? _(summary) : this._keyToDescription(key);

      groups.get(categoryName).push({
        shortcut: shortcutStr,
        description: description,
      });
    }

    // Sort groups by category definition order, with "Other" at the end
    const orderedGroups = [];
    const categoryOrder = [...new Set(cats.map((c) => c.name)), otherName];

    for (const catName of categoryOrder) {
      if (groups.has(catName)) {
        orderedGroups.push([catName, groups.get(catName)]);
      }
    }

    return orderedGroups;
  }

  _formatShortcut(accelerator) {
    // Convert GTK accelerator format to readable format
    return accelerator
      .replace(/<Super>/g, "Super+")
      .replace(/<Shift>/g, "Shift+")
      .replace(/<Ctrl>/g, "Ctrl+")
      .replace(/<Alt>/g, "Alt+")
      .replace(/<Primary>/g, "Ctrl+")
      .replace(/Left$/, "\u2190")
      .replace(/Right$/, "\u2192")
      .replace(/Up$/, "\u2191")
      .replace(/Down$/, "\u2193");
  }

  _keyToDescription(key) {
    // Fallback: convert key name to description
    return key
      .replace(/-/g, " ")
      .replace(/^(window|con|workspace|focus|prefs)\s+/, "")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  // Center the overlay on the current monitor. Requires the overlay to be
  // parented so its preferred size is resolved.
  _recenter() {
    if (!this._overlay) return;

    const monitorGeom = Utils.getMonitorGeometrySafe(global.display.get_current_monitor());
    if (!monitorGeom) return; // leave the overlay where it is if geometry is unavailable

    const [, naturalWidth] = this._overlay.get_preferred_width(-1);
    const [, naturalHeight] = this._overlay.get_preferred_height(-1);

    const x = monitorGeom.x + Math.floor((monitorGeom.width - naturalWidth) / 2);
    const y = monitorGeom.y + Math.floor((monitorGeom.height - naturalHeight) / 2);

    this._overlay.set_position(x, y);
  }

  show() {
    if (this._visible) return;

    try {
      this._buildOverlay();
      this._ensureBackdrop();

      // _buildOverlay()/_ensureBackdrop() have populated both actors (or thrown);
      // bail defensively if either is somehow absent so we never proceed to parent
      // and grab focus with a half-built sheet.
      if (!this._overlay || !this._backdrop) return;

      // Add to UI group only when not already parented. A fast toggle can call
      // show() while the 100ms hide ease still has the overlay parented; adding
      // again would trip Clutter's single-parent invariant (forge-v3y3). Add the
      // backdrop first so the panel stacks above it.
      if (this._backdrop.get_parent() == null) {
        Main.layoutManager.uiGroup.add_child(this._backdrop);
      }
      if (this._overlay.get_parent() == null) {
        Main.layoutManager.uiGroup.add_child(this._overlay);
      }
      // Keep the panel above the click-catcher backdrop even when a reused
      // overlay was already parented (so its close button stays clickable).
      Main.layoutManager.uiGroup.set_child_above_sibling(this._overlay, this._backdrop);

      this._sizeBackdrop();
      this._recenter();
      // Cancel any in-flight hide ease so a fast re-press resolves cleanly
      // instead of leaving _visible and the actor state out of sync (forge-0rb6).
      this._overlay.remove_all_transitions();
      this._overlay.show();
      /** @type {Easable} */ (this._overlay).ease({
        opacity: 255,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
      // Actor-level key focus (not a modal grab) so Escape reaches the overlay
      // while the global toggle accelerator keeps working.
      this._overlay.grab_key_focus();

      // Re-center on monitor/resolution changes while visible (forge-k5m6).
      // monitors-changed is emitted by Main.layoutManager, NOT by MetaDisplay;
      // connecting on global.display threw and stranded the input-grabbing
      // overlay with _visible never set (forge-0rb6).
      if (!this._monitorsChangedId) {
        this._monitorsChangedId = Main.layoutManager.connect("monitors-changed", () => {
          this._sizeBackdrop();
          this._recenter();
        });
      }

      this._visible = true;
      Logger.debug("cheatsheet: show");
    } catch (e) {
      // Never leave a half-shown, input-grabbing overlay on screen: tear down
      // whatever got parented before the throw so the desktop stays usable.
      Logger.warn(`cheatsheet: show failed, tearing down: ${e}`);
      this.hide();
    }
  }

  hide() {
    // Tear down whatever is on screen regardless of _visible: a show() that
    // threw mid-flight can leave the reactive overlay/backdrop parented with
    // _visible still false, and that strand must always be dismissable.
    if (!this._overlay && !this._backdrop) return;

    this._visible = false;
    this._disconnectMonitorsChanged();
    // Drop the backdrop immediately so it stops catching clicks during the fade.
    this._removeBackdrop();

    if (!this._overlay) return;

    // Release the actor-level key focus so the fading panel stops swallowing
    // keystrokes meant for the desktop.
    const stage = /** @type {Clutter.Stage} */ (global.stage);
    if (stage.get_key_focus() === this._overlay) {
      stage.set_key_focus(null);
    }

    // Capture the actor locally: a fast re-show may revive this._overlay before
    // the ease completes, and the onComplete must only retire the actor it began
    // fading — never the revived one.
    const overlay = this._overlay;
    overlay.remove_all_transitions();
    /** @type {Easable} */ (overlay).ease({
      opacity: 0,
      duration: 100,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        if (overlay.get_parent()) {
          Main.layoutManager.uiGroup.remove_child(overlay);
        }
        overlay.destroy();
        if (this._overlay === overlay) this._overlay = null;
      },
    });

    Logger.debug("cheatsheet: hide");
  }

  // Full-screen reactive layer behind the panel; a click anywhere off the panel
  // dismisses the sheet (forge-0rb6).
  _ensureBackdrop() {
    if (this._backdrop) return;
    this._backdrop = new St.Widget({
      reactive: true,
      style_class: "forge-cheatsheet-backdrop",
    });
    this._backdrop.connect("button-press-event", () => {
      this.hide();
      return Clutter.EVENT_STOP;
    });
  }

  _sizeBackdrop() {
    if (!this._backdrop) return;
    this._backdrop.set_position(0, 0);
    this._backdrop.set_size(global.stage.get_width(), global.stage.get_height());
  }

  _removeBackdrop() {
    if (!this._backdrop) return;
    if (this._backdrop.get_parent()) {
      Main.layoutManager.uiGroup.remove_child(this._backdrop);
    }
    this._backdrop.destroy();
    this._backdrop = null;
  }

  _disconnectMonitorsChanged() {
    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId);
      this._monitorsChangedId = 0;
    }
  }

  get visible() {
    return this._visible;
  }

  destroy() {
    this._disconnectMonitorsChanged();
    this._removeBackdrop();
    if (this._overlay) {
      if (this._overlay.get_parent()) {
        Main.layoutManager.uiGroup.remove_child(this._overlay);
      }
      this._overlay.destroy();
      this._overlay = null;
    }
    this._visible = false;
  }
}
