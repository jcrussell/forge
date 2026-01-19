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

import { Logger } from "../shared/logger.js";

// Category display names and their key prefixes
const CATEGORIES = [
  { prefix: "window-focus", name: "Focus" },
  { prefix: "window-swap", name: "Swap" },
  { prefix: "window-move", name: "Move" },
  { prefix: "window-resize", name: "Resize" },
  { prefix: "window-snap", name: "Snap" },
  { prefix: "window-toggle", name: "Window Toggle" },
  { prefix: "window-gap", name: "Gaps" },
  { prefix: "window-reset", name: "Window Reset" },
  { prefix: "window-expand", name: "Window Size" },
  { prefix: "window-shrink", name: "Window Size" },
  { prefix: "window-pointer", name: "Pointer" },
  { prefix: "con-split", name: "Split" },
  { prefix: "con-stacked", name: "Stacked" },
  { prefix: "con-tabbed", name: "Tabbed" },
  { prefix: "workspace", name: "Workspace" },
  { prefix: "focus-border", name: "Appearance" },
  { prefix: "prefs", name: "Preferences" },
];

// Human-readable descriptions for keybinding keys
const KEY_DESCRIPTIONS = {
  "window-focus-left": "Focus window left",
  "window-focus-right": "Focus window right",
  "window-focus-up": "Focus window up",
  "window-focus-down": "Focus window down",
  "window-swap-left": "Swap window left",
  "window-swap-right": "Swap window right",
  "window-swap-up": "Swap window up",
  "window-swap-down": "Swap window down",
  "window-swap-last-active": "Swap with last active",
  "window-move-left": "Move window left",
  "window-move-right": "Move window right",
  "window-move-up": "Move window up",
  "window-move-down": "Move window down",
  "window-toggle-float": "Toggle float",
  "window-toggle-always-float": "Toggle always float",
  "window-gap-size-increase": "Increase gap size",
  "window-gap-size-decrease": "Decrease gap size",
  "window-reset-sizes": "Reset window sizes",
  "window-resize-left-increase": "Grow left edge",
  "window-resize-left-decrease": "Shrink left edge",
  "window-resize-right-increase": "Grow right edge",
  "window-resize-right-decrease": "Shrink right edge",
  "window-resize-top-increase": "Grow top edge",
  "window-resize-top-decrease": "Shrink top edge",
  "window-resize-bottom-increase": "Grow bottom edge",
  "window-resize-bottom-decrease": "Shrink bottom edge",
  "window-snap-one-third-left": "Snap 1/3 left",
  "window-snap-two-third-left": "Snap 2/3 left",
  "window-snap-one-third-right": "Snap 1/3 right",
  "window-snap-two-third-right": "Snap 2/3 right",
  "window-snap-center": "Snap center",
  "window-expand": "Expand window",
  "window-shrink": "Shrink window",
  "window-pointer-to-focus": "Move pointer to focus",
  "con-split-layout-toggle": "Toggle split direction",
  "con-split-horizontal": "Split horizontal",
  "con-split-vertical": "Split vertical",
  "con-stacked-layout-toggle": "Toggle stacked layout",
  "con-tabbed-layout-toggle": "Toggle tabbed layout",
  "con-tabbed-showtab-decoration-toggle": "Toggle tab decoration",
  "workspace-active-tile-toggle": "Toggle workspace tiling",
  "workspace-monocle-toggle": "Toggle monocle mode",
  "focus-border-toggle": "Toggle focus border",
  "prefs-tiling-toggle": "Toggle tiling mode",
  "prefs-open": "Open preferences",
  "prefs-config-reload": "Reload configuration",
  "prefs-app-launch": "Launch application",
  "prefs-cheatsheet-toggle": "Toggle this cheatsheet",
};

export class Cheatsheet extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /** @type {import('./extension.js').default} */
  ext;

  /** @type {St.BoxLayout} */
  _overlay = null;

  /** @type {boolean} */
  _visible = false;

  constructor(ext) {
    super();
    this.ext = ext;
    Logger.debug("created cheatsheet");
  }

  _buildOverlay() {
    if (this._overlay) {
      return;
    }

    // Main container
    this._overlay = new St.BoxLayout({
      style_class: "forge-cheatsheet",
      vertical: true,
      reactive: true,
    });

    // Title
    const title = new St.Label({
      text: "FORGE KEYBINDINGS",
      style_class: "forge-cheatsheet-title",
    });
    this._overlay.add_child(title);

    // Content container with columns
    const contentBox = new St.BoxLayout({
      vertical: false,
      style: "spacing: 32px;",
    });
    this._overlay.add_child(contentBox);

    // Get keybindings grouped by category
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

      // Choose column with fewer items
      const column = leftCount <= rightCount ? leftColumn : rightColumn;
      const count = bindings.length + 1; // +1 for header

      if (leftCount <= rightCount) {
        leftCount += count;
      } else {
        rightCount += count;
      }

      // Category header
      const categoryLabel = new St.Label({
        text: categoryName.toUpperCase(),
        style_class: "forge-cheatsheet-category",
      });
      column.add_child(categoryLabel);

      // Keybinding rows
      for (const binding of bindings) {
        const row = new St.BoxLayout({
          style_class: "forge-cheatsheet-row",
        });

        const keyLabel = new St.Label({
          text: binding.shortcut,
          style_class: "forge-cheatsheet-key",
        });
        row.add_child(keyLabel);

        const descLabel = new St.Label({
          text: binding.description,
          style_class: "forge-cheatsheet-desc",
        });
        row.add_child(descLabel);

        column.add_child(row);
      }
    }
  }

  _getGroupedKeybindings() {
    const kbdSettings = this.ext.kbdSettings;
    const keys = kbdSettings.list_keys();
    const groups = new Map();

    // Initialize groups
    const seenCategories = new Set();

    for (const key of keys) {
      const shortcuts = kbdSettings.get_strv(key);
      if (!shortcuts || shortcuts.length === 0) continue;

      // Find matching category
      let categoryName = "Other";
      for (const cat of CATEGORIES) {
        if (key.startsWith(cat.prefix)) {
          categoryName = cat.name;
          break;
        }
      }

      // Merge duplicate category names
      if (!groups.has(categoryName)) {
        groups.set(categoryName, []);
      }

      // Format shortcut for display
      const shortcutStr = shortcuts
        .map((s) => this._formatShortcut(s))
        .join(", ");

      // Get description
      const description = KEY_DESCRIPTIONS[key] || this._keyToDescription(key);

      groups.get(categoryName).push({
        shortcut: shortcutStr,
        description: description,
      });
    }

    // Sort groups by a predefined order
    const orderedGroups = [];
    const categoryOrder = [
      "Focus",
      "Swap",
      "Move",
      "Resize",
      "Window Size",
      "Snap",
      "Window Toggle",
      "Gaps",
      "Window Reset",
      "Pointer",
      "Split",
      "Stacked",
      "Tabbed",
      "Workspace",
      "Appearance",
      "Preferences",
      "Other",
    ];

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

  show() {
    if (this._visible) return;

    this._buildOverlay();

    // Get current monitor geometry
    const currentMonitor = global.display.get_current_monitor();
    const monitorGeom = global.display.get_monitor_geometry(currentMonitor);

    // Add to UI group
    Main.layoutManager.uiGroup.add_child(this._overlay);

    // Get overlay size after adding to stage
    const [, naturalWidth] = this._overlay.get_preferred_width(-1);
    const [, naturalHeight] = this._overlay.get_preferred_height(-1);

    // Center on current monitor
    const x = monitorGeom.x + Math.floor((monitorGeom.width - naturalWidth) / 2);
    const y = monitorGeom.y + Math.floor((monitorGeom.height - naturalHeight) / 2);

    this._overlay.set_position(x, y);
    this._overlay.show();
    this._overlay.ease({
      opacity: 255,
      duration: 150,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });

    this._visible = true;
    Logger.debug("cheatsheet: show");
  }

  hide() {
    if (!this._visible || !this._overlay) return;

    this._overlay.ease({
      opacity: 0,
      duration: 100,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        if (this._overlay) {
          Main.layoutManager.uiGroup.remove_child(this._overlay);
          this._overlay.destroy();
          this._overlay = null;
        }
      },
    });

    this._visible = false;
    Logger.debug("cheatsheet: hide");
  }

  get visible() {
    return this._visible;
  }

  destroy() {
    if (this._overlay) {
      if (this._visible) {
        Main.layoutManager.uiGroup.remove_child(this._overlay);
      }
      this._overlay.destroy();
      this._overlay = null;
    }
    this._visible = false;
  }
}
