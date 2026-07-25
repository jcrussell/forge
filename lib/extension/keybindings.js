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
import Meta from "gi://Meta";
import Shell from "gi://Shell";

// Gnome Shell imports
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// Shared state
import { Logger } from "../shared/logger.js";

const DEFAULT_FLOAT_LAYOUT = { mode: "float", x: "center", y: "center", width: 0.65, height: 0.75 };

export class Keybindings extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /** @type {import('../../extension.js').default} */
  ext;

  /** @type {import('./cheatsheet.js').Cheatsheet | null} */
  cheatsheet = null;

  constructor(ext) {
    super();
    Logger.debug(`created keybindings`);
    this.ext = ext;
    this.extWm = ext.extWm;
    this.kbdSettings = ext.kbdSettings;
    this.settings = ext.settings;
    this.buildBindingDefinitions();
  }

  enable() {
    // Bug #354: sessionMode "updated" can re-emit with a user mode while
    // already enabled; re-adding bindings makes Mutter log "Overwriting
    // existing binding" for every key.
    if (this._enabled) return;

    let keybindings = this._bindings;

    for (const key in keybindings) {
      Main.wm.addKeybinding(
        key,
        this.kbdSettings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL,
        keybindings[key]
      );
    }

    this._enabled = true;
    Logger.debug(`keybindings:enable`);
  }

  disable() {
    if (this._enabled) {
      let keybindings = this._bindings;

      for (const key in keybindings) {
        Main.wm.removeKeybinding(key);
      }

      this._enabled = false;
    }

    if (this.cheatsheet?.visible) {
      this.cheatsheet.hide();
    }

    Logger.debug(`keybindings:disable`);
  }

  get modifierState() {
    const [_x, _y, state] = this.extWm.getPointer();
    return state;
  }

  allowDragDropTile() {
    const tileModifier = this.kbdSettings.get_string("mod-mask-mouse-tile");
    const modState = this.modifierState;
    // Using Clutter.ModifierType values and also testing for pointer
    // being grabbed (256). E.g. grabbed + pressing Super = 256 + 64 = 320
    // See window.js#_handleMoving() - an overlay preview is shown.
    // See window.js#_handleGrabOpEnd() - when the drag has been dropped
    switch (tileModifier) {
      case "Super":
        return modState === 64 || modState === 320;
      case "Alt":
        return modState === 8 || modState === 264;
      case "Ctrl":
        return modState === 4 || modState === 260;
      case "Shift":
        // SHIFT_MASK is 1<<0 = 1 (257 with the pointer-grabbed bit 256); 2 is
        // LOCK_MASK (Caps Lock), so testing 2/258 tiled on Caps Lock and never
        // on Shift (forge-3ilf).
        return modState === 1 || modState === 257;
      case "None":
        return true;
    }
    return false;
  }

  _directionalBindings(commandName, keyPrefix) {
    const bindings = {};
    for (const dir of ["left", "down", "up", "right"]) {
      const dirCap = dir.charAt(0).toUpperCase() + dir.slice(1);
      bindings[`${keyPrefix}-${dir}`] = () => {
        this.extWm.command({ name: commandName, direction: dirCap });
      };
    }
    return bindings;
  }

  _simpleCommandBindings(map) {
    const bindings = {};
    for (const [key, action] of Object.entries(map)) {
      bindings[key] = () => {
        this.extWm.command(action);
      };
    }
    return bindings;
  }

  _resizeBindings() {
    const bindings = {};
    for (const dir of ["top", "bottom", "left", "right"]) {
      const dirCap = dir.charAt(0).toUpperCase() + dir.slice(1);
      bindings[`window-resize-${dir}-increase`] = () => {
        this.extWm.command({
          name: `WindowResize${dirCap}`,
          amount: this.settings.get_uint("resize-amount"),
        });
      };
      bindings[`window-resize-${dir}-decrease`] = () => {
        this.extWm.command({
          name: `WindowResize${dirCap}`,
          amount: -1 * this.settings.get_uint("resize-amount"),
        });
      };
    }
    return bindings;
  }

  buildBindingDefinitions() {
    this._bindings = {
      "window-toggle-float": () => {
        this.extWm.command({ name: "FloatToggle", ...DEFAULT_FLOAT_LAYOUT });
      },
      "window-toggle-always-float": () => {
        this.extWm.command({ name: "FloatClassToggle", ...DEFAULT_FLOAT_LAYOUT });
      },
      ...this._directionalBindings("Focus", "window-focus"),
      ...this._directionalBindings("Swap", "window-swap"),
      ...this._directionalBindings("Move", "window-move"),
      ...this._simpleCommandBindings({
        "con-split-layout-toggle": { name: "LayoutToggle" },
        "con-split-vertical": { name: "Split", orientation: "vertical" },
        "con-split-horizontal": { name: "Split", orientation: "horizontal" },
        "con-stacked-layout-toggle": { name: "LayoutStackedToggle" },
        "con-tabbed-layout-toggle": { name: "LayoutTabbedToggle" },
        "con-tabbed-showtab-decoration-toggle": { name: "ShowTabDecorationToggle" },
        "focus-border-toggle": { name: "FocusBorderToggle" },
        "prefs-tiling-toggle": { name: "TilingModeToggle" },
        "window-gap-size-increase": { name: "GapSize", amount: 1 },
        "window-gap-size-decrease": { name: "GapSize", amount: -1 },
        "workspace-active-tile-toggle": { name: "WorkspaceActiveTileToggle" },
        "window-reset-sizes": { name: "WindowResetSizes" },
        "window-golden-ratio": { name: "WindowGoldenRatio" },
        "prefs-open": { name: "PrefsOpen" },
        "window-swap-last-active": { name: "WindowSwapLastActive" },
        "window-focus-next": { name: "FocusNext" },
        "window-focus-prev": { name: "FocusPrev" },
        "window-swap-next": { name: "SwapNext" },
        "window-swap-prev": { name: "SwapPrev" },
        "window-snap-one-third-right": {
          name: "SnapLayoutMove",
          direction: "Right",
          amount: 1 / 3,
        },
        "window-snap-two-third-right": {
          name: "SnapLayoutMove",
          direction: "Right",
          amount: 2 / 3,
        },
        "window-snap-one-third-left": { name: "SnapLayoutMove", direction: "Left", amount: 1 / 3 },
        "window-snap-two-third-left": { name: "SnapLayoutMove", direction: "Left", amount: 2 / 3 },
        "window-snap-center": { name: "SnapLayoutMove", direction: "Center" },
        "prefs-config-reload": { name: "ConfigReload" },
        "prefs-config-export": { name: "ConfigExport" },
        "window-pointer-to-focus": { name: "MovePointerToFocus" },
        "workspace-monocle-toggle": { name: "WorkspaceMonocleToggle" },
      }),
      ...this._resizeBindings(),
      "window-expand": () => {
        this.extWm.command({
          name: "WindowExpand",
          amount: this.settings.get_uint("resize-amount"),
        });
      },
      "window-shrink": () => {
        this.extWm.command({
          name: "WindowShrink",
          amount: this.settings.get_uint("resize-amount"),
        });
      },
      "prefs-app-launch": () => {
        const command = this.settings.get_string("launch-app-command");
        if (command) {
          try {
            GLib.spawn_command_line_async(command);
          } catch (e) {
            Logger.error(`Failed to launch app: ${e.message}`);
            Main.notify("Forge", `Failed to launch "${command}": ${e.message}`);
          }
        }
      },
      "prefs-cheatsheet-toggle": () => {
        if (this.cheatsheet) {
          if (this.cheatsheet.visible) {
            this.cheatsheet.hide();
          } else {
            this.cheatsheet.show();
          }
        }
      },
      "prefs-lock-screen": () => {
        try {
          GLib.spawn_command_line_async("loginctl lock-session");
        } catch (e) {
          Logger.error(`Failed to lock screen: ${e.message}`);
        }
      },
    };
  }
}
