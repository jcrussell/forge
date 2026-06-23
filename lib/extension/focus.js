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
    const shouldWarp = force || this._extWm.ext.settings.get_boolean("move-pointer-focus-enabled");
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
        .forEach((child) => child.nodeValue.raise());
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
      metaWindow.raise();
    }
  }

  /**
   * Focus the window under the pointer and raise it.
   *
   * @returns {boolean} true if we should continue polling, false otherwise
   */
  _focusWindowUnderPointer() {
    // Break the loop if the user has disabled the feature
    // or if the window manager is disabled
    if (!this._extWm.shouldFocusOnHover || this._extWm.disabled) {
      // The source self-destructs on `false`; zero the stale ID or the next
      // pointerLoopInit/_removeSignals calls GLib.Source.remove on a dead ID.
      this._extWm._pointerFocusTimeoutId = 0;
      return false;
    }

    // Feature #458: Skip hover-to-focus if tiling-only mode is set and tiling is disabled
    const tilingOnly = this._extWm.ext.settings.get_boolean("focus-on-hover-tiling-only");
    const tilingEnabled = this._extWm.ext.settings.get_boolean("tiling-mode-enabled");
    if (tilingOnly && !tilingEnabled) return true;

    // We don't want to focus windows when the overview is visible
    if (Main.overview.visible) return true;

    // Bug #374 fix: Skip focus-on-hover during workspace transitions
    if (this._extWm._workspaceChanging) return true;

    // Don't steal focus from modal dialogs or password prompts (#483)
    const focusedWindow = global.display.focus_window;
    if (focusedWindow) {
      const focusedType = focusedWindow.get_window_type();
      if (focusedType === Meta.WindowType.MODAL_DIALOG || focusedType === Meta.WindowType.DIALOG) {
        // A modal/dialog has focus - don't steal it
        return true;
      }
    }

    // Get the global mouse position
    let pointer = global.get_pointer();

    const metaWindow = this._extWm._getMetaWindowAtPointer(pointer);

    if (metaWindow) {
      // If window is not null, focus it
      metaWindow.focus(global.get_current_time());
      // Raise it to the top
      metaWindow.raise();
    }

    // Continue polling
    return true;
  }
}
