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
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Meta from "gi://Meta";

// Gnome Shell imports
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// Shared state
import { Logger } from "../shared/logger.js";

// App imports
import { LAYOUT_TYPES } from "./tree.js";
import * as Utils from "./utils.js";

/**
 * FocusManager owns the focus/pointer-follow cluster for WindowManager:
 * pointer warping (movePointerWith/warpPointerToNodeWindow), the focus-on-hover
 * pointer loop (pointerLoopInit/_focusWindowUnderPointer), and stacked/tabbed
 * focus restacking (updateStackedFocus/updateTabbedFocus). Extracted from
 * window.js to keep the focus cluster in one place.
 *
 * Shared WindowManager state and helpers are read/called LIVE via this._extWm so
 * behavior is preserved. In particular: _freezeRender is read live each call (never
 * cached); the fields lastFocusedWindow, shouldFocusOnHover, _pointerFocusTimeoutId,
 * disabled and _workspaceChanging stay on WindowManager and are accessed through
 * this._extWm (so staying paths and _removeSignals' _pointerFocusTimeoutId cleanup
 * remain intact). Cross-calls between moved methods route through this._extWm too,
 * so spies on the WindowManager instance still intercept them.
 */
export class FocusManager extends GObject.Object {
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
   * Moves the pointer along with the nodeWindow's meta
   *
   * This is useful for making sure that Forge calculates the attachNode
   * properly
   */
  movePointerWith(nodeWindow, { force = false } = {}) {
    if (!nodeWindow || !nodeWindow._data) return;
    const settings = this._extWm.ext.settings;
    if (!settings) return;
    const shouldWarp = force || settings.get_boolean("move-pointer-focus-enabled");
    if (shouldWarp) {
      this._extWm.storePointerLastPosition(this._extWm.lastFocusedWindow);
      if (this._extWm.canMovePointerInsideNodeWindow(nodeWindow)) {
        this._extWm.warpPointerToNodeWindow(nodeWindow);
      }
    }
    this._extWm.lastFocusedWindow = nodeWindow;
    this._tree.debugParentNodes(nodeWindow);
  }

  warpPointerToNodeWindow(nodeWindow) {
    const newCoord = this._extWm.getPointerPositionInside(nodeWindow);
    if (newCoord && newCoord.x && newCoord.y) {
      const seat = Clutter.get_default_backend().get_default_seat();
      if (seat) {
        const wmTitle = nodeWindow.nodeValue.get_title();
        Logger.debug(`moved pointer to [${wmTitle}] at (${newCoord.x},${newCoord.y})`);
        seat.warp_pointer(newCoord.x, newCoord.y);
      }
    }
  }

  pointerLoopInit() {
    this._extWm._clearTimeoutId("_pointerFocusTimeoutId");

    this._extWm._pointerFocusTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      16,
      this._extWm._focusWindowUnderPointer.bind(this._extWm)
    );
  }

  updateStackedFocus(focusNodeWindow) {
    if (!focusNodeWindow || !focusNodeWindow.parentNode) return;
    const parentNode = focusNodeWindow.parentNode;
    if (parentNode.layout === LAYOUT_TYPES.STACKED && !this._extWm._freezeRender) {
      parentNode.appendChild(focusNodeWindow);
      parentNode.childNodes
        .filter((child) => child.isWindow())
        .forEach((child) => Utils.safeRaise(child.nodeValue));
      this._extWm.queueEvent({
        name: "render-focus-stack",
        callback: () => {
          this._extWm.renderTree("focus-stacked");
        },
      });
    }
  }

  updateTabbedFocus(focusNodeWindow) {
    if (!focusNodeWindow || !focusNodeWindow.parentNode) return;
    if (focusNodeWindow.parentNode.layout === LAYOUT_TYPES.TABBED && !this._extWm._freezeRender) {
      const metaWindow = focusNodeWindow.nodeValue;
      Utils.safeRaise(metaWindow);
    }
  }

  /**
   * Focus the window under the pointer and raise it.
   *
   * @returns {boolean} true if we should continue polling, false otherwise
   */
  _focusWindowUnderPointer() {
    if (!this._extWm.shouldFocusOnHover || this._extWm.disabled) {
      // The source self-destructs on `false`; zero the stale ID or the next
      // pointerLoopInit/_removeSignals calls GLib.Source.remove on a dead ID.
      this._extWm._pointerFocusTimeoutId = 0;
      return false;
    }

    // Feature #458: Skip hover-to-focus if tiling-only mode is set and tiling is disabled
    const settings = this._extWm.ext.settings;
    if (!settings) return false;
    const tilingOnly = settings.get_boolean("focus-on-hover-tiling-only");
    const tilingEnabled = settings.get_boolean("tiling-mode-enabled");
    if (tilingOnly && !tilingEnabled) return true;

    // We don't want to focus windows when the overview is visible
    if (Main.overview.visible) return true;

    // Bug #374 fix: Skip focus-on-hover during workspace transitions
    if (this._extWm._workspaceChanging) return true;

    // A shell dialog (polkit or keyring password, run dialog) or the lock
    // screen has the keyboard: leave it there (forge-ext/forge#483)
    if (Main.modalCount > 0 || Main.sessionMode.isLocked) return true;

    // Don't steal focus from modal dialogs or password prompts (#483)
    const focusedWindow = global.display.focus_window;
    if (focusedWindow) {
      const focusedType = focusedWindow.get_window_type();
      if (focusedType === Meta.WindowType.MODAL_DIALOG || focusedType === Meta.WindowType.DIALOG) {
        return true;
      }
    }

    let pointer = global.get_pointer();

    const metaWindow = this._extWm._getMetaWindowAtPointer(pointer);

    // Only when the pointer reaches another window: re-focusing (and raising)
    // the focused one every poll closes its open menus
    if (metaWindow && metaWindow !== global.display.focus_window) {
      Utils.safeFocus(metaWindow, global.get_current_time());
      Utils.safeRaise(metaWindow);
    }

    return true;
  }
}
