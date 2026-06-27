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
import GObject from "gi://GObject";
import Meta from "gi://Meta";

// Shared state
import { Logger } from "../shared/logger.js";

// App imports
import { NODE_TYPES, LAYOUT_TYPES, ORIENTATION_TYPES } from "./tree.js";
import * as Utils from "./utils.js";

/**
 * CommandHandler processes keyboard and action commands for the window manager.
 */
export class CommandHandler extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  /** @type {import('./window.js').WindowManager} */
  _extWm;

  /**
   * @param {import('./window.js').WindowManager} extWm
   */
  constructor(extWm) {
    super();
    this._extWm = extWm;
    this._buildHandlers();
  }

  /**
   * Execute a command action
   * @param {Object} action - The action to execute
   * @param {string} action.name - The command name
   */
  execute(action) {
    const wm = this._extWm;
    const ctx = {
      wm,
      focusWindow: wm.focusMetaWindow,
      focusNodeWindow: wm.findNodeWindow(wm.focusMetaWindow),
    };
    const handler = this._handlers[action.name];
    // Unknown action names are a no-op.
    if (handler) handler(action, ctx);
  }

  /**
   * Build the action-name -> handler registry. Each handler receives
   * `(action, ctx)` where `ctx = { wm, focusWindow, focusNodeWindow }`. Handlers
   * that reassign `focusNodeWindow` destructure it as a local (`let`); no handler
   * reads another's reassignment, so the ctx field is never mutated in place.
   */
  _buildHandlers() {
    // Float toggles share one body and branch on action.name internally via
    // wm.toggleFloatingMode(action, ...).
    const floatToggle = (action, ctx) => {
      const { wm, focusWindow, focusNodeWindow } = ctx;
      // No tracked focus window (empty desktop, or focus on an untracked
      // window type): toggleFloatingMode would no-op, but the rect/parent
      // work below dereferences both — bail like the other cases do.
      if (!focusNodeWindow) return;
      wm.toggleFloatingMode(action, focusWindow);

      const rectRequest = {
        x: action.x,
        y: action.y,
        width: action.width,
        height: action.height,
      };

      wm.move(focusWindow, Utils.resolveRect(rectRequest, focusWindow));

      let existParent = focusNodeWindow.parentNode;
      // Hardening: a detached focus node (no parentNode) would throw on the
      // childNodes deref below — bail like WindowResetSizes does (forge-t1s9).
      if (!existParent) return;

      if (wm.tree.getTiledChildren(existParent.childNodes).length <= 1) {
        existParent.percent = 0.0;
        wm.tree.resetSiblingPercent(existParent.parentNode);
      }

      wm.tree.resetSiblingPercent(existParent);
      wm.renderTree("float-toggle", true);
    };

    // FocusNext/FocusPrev share one body and branch on action.name internally.
    const focusSibling = (action, ctx) => {
      const { wm } = ctx;
      let { focusNodeWindow } = ctx;
      // Cyclic, non-directional focus among tiled siblings (forge-zrl).
      const offset = action.name === "FocusNext" ? 1 : -1;
      const focused = wm.tree.focusSibling(focusNodeWindow, offset);
      if (focused) focusNodeWindow = focused;
      if (!focusNodeWindow) {
        focusNodeWindow = wm.findNodeWindow(wm.focusMetaWindow);
      }
      wm.updateStackedFocus(focusNodeWindow);
      wm.updateTabbedFocus(focusNodeWindow);
    };

    // SwapNext/SwapPrev share one body and branch on action.name internally.
    const swapSibling = (action, ctx) => {
      const { wm, focusNodeWindow } = ctx;
      // Cyclic, non-directional swap with a tiled sibling (forge-zrl).
      if (!focusNodeWindow) return;
      wm.unfreezeRender();
      const offset = action.name === "SwapNext" ? 1 : -1;
      const swapped = wm.tree.swapSibling(focusNodeWindow, offset);
      if (swapped) {
        focusNodeWindow.nodeValue.raise();
        wm.updateTabbedFocus(focusNodeWindow);
        wm.updateStackedFocus(focusNodeWindow);
        wm.movePointerWith(focusNodeWindow);
        wm.renderTree("swap-sibling", true);
      }
    };

    this._handlers = {
      FloatNonPersistentToggle: floatToggle,
      FloatToggle: floatToggle,
      FloatClassToggle: floatToggle,

      Move: (action, ctx) => {
        const { wm } = ctx;
        let { focusNodeWindow } = ctx;
        wm.unfreezeRender();
        let moveDirection = Utils.resolveDirection(action.direction);
        let prev = focusNodeWindow;
        let moved = wm.tree.move(focusNodeWindow, moveDirection);
        if (!focusNodeWindow) {
          focusNodeWindow = wm.findNodeWindow(wm.focusMetaWindow);
        }
        wm.queueEvent({
          name: "move",
          callback: () => {
            if (wm.eventQueue.length <= 0) {
              wm.unfreezeRender();
              // forge-ne1 (#324): the node captured at queue time can be gone
              // by the time this fires (>=220ms): null focus fallback, window
              // closed (removeChild nulls parentNode), or MetaWindow disposed
              // after sleep/resume. Bail before touching parentNode/nodeValue.
              if (
                !focusNodeWindow ||
                !focusNodeWindow.parentNode ||
                !Utils.isWindowAlive(focusNodeWindow.nodeValue)
              ) {
                return;
              }
              if (focusNodeWindow.parentNode.layout === LAYOUT_TYPES.STACKED) {
                focusNodeWindow.parentNode.appendChild(focusNodeWindow);
                focusNodeWindow.nodeValue.raise();
                focusNodeWindow.nodeValue.activate(global.display.get_current_time());
                wm.renderTree("move-stacked-queue");
              }
              if (focusNodeWindow.parentNode.layout === LAYOUT_TYPES.TABBED) {
                focusNodeWindow.nodeValue.raise();
                focusNodeWindow.nodeValue.activate(global.display.get_current_time());
                if (prev && prev.parentNode) prev.parentNode.lastTabFocus = prev.nodeValue;
                wm.renderTree("move-tabbed-queue");
              }
              wm.movePointerWith(focusNodeWindow);
            }
          },
        });
        if (moved) {
          if (prev) prev.parentNode.lastTabFocus = prev.nodeValue;
          wm.renderTree("move-window");
        }
      },

      Focus: (action, ctx) => {
        const { wm } = ctx;
        let { focusNodeWindow } = ctx;
        let focusDirection = Utils.resolveDirection(action.direction);
        focusNodeWindow = wm.tree.focus(focusNodeWindow, focusDirection);
        if (!focusNodeWindow) {
          focusNodeWindow = wm.findNodeWindow(wm.focusMetaWindow);
        }
        wm.updateStackedFocus(focusNodeWindow);
        wm.updateTabbedFocus(focusNodeWindow);
      },

      Swap: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        if (!focusNodeWindow) return;
        wm.unfreezeRender();
        let swapDirection = Utils.resolveDirection(action.direction);
        wm.tree.swap(focusNodeWindow, swapDirection);
        focusNodeWindow.nodeValue.raise();
        wm.updateTabbedFocus(focusNodeWindow);
        wm.updateStackedFocus(focusNodeWindow);
        wm.movePointerWith(focusNodeWindow);
        wm.renderTree("swap", true);
      },

      FocusNext: focusSibling,
      FocusPrev: focusSibling,

      SwapNext: swapSibling,
      SwapPrev: swapSibling,

      Split: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        if (!focusNodeWindow) return;
        let currentLayout = focusNodeWindow.parentNode.layout;
        if (currentLayout === LAYOUT_TYPES.STACKED || currentLayout === LAYOUT_TYPES.TABBED) {
          return;
        }
        let orientation = action.orientation
          ? action.orientation.toUpperCase()
          : ORIENTATION_TYPES.NONE;
        wm.tree.split(focusNodeWindow, orientation);
        wm.applyDefaultLayoutToContainer(focusNodeWindow.parentNode);
        wm.renderTree("split");
      },

      LayoutToggle: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        if (!focusNodeWindow) return;
        let currentLayout = focusNodeWindow.parentNode.layout;
        if (currentLayout === LAYOUT_TYPES.HSPLIT) {
          focusNodeWindow.parentNode.layout = LAYOUT_TYPES.VSPLIT;
        } else if (currentLayout === LAYOUT_TYPES.VSPLIT) {
          focusNodeWindow.parentNode.layout = LAYOUT_TYPES.HSPLIT;
        }
        wm.tree.attachNode = focusNodeWindow.parentNode;
        wm.renderTree("layout-split-toggle");
      },

      FocusBorderToggle: (action, ctx) => {
        const { wm } = ctx;
        let focusBorderEnabled = wm.ext.settings.get_boolean("focus-border-toggle");
        wm.ext.settings.set_boolean("focus-border-toggle", !focusBorderEnabled);
      },

      TilingModeToggle: (action, ctx) => {
        const { wm } = ctx;
        // This toggle preserves tree state while disabling tiling, unlike Extension.disable()
        // which completely tears down the extension. Useful for temporarily floating all windows.
        let tilingModeEnabled = wm.ext.settings.get_boolean("tiling-mode-enabled");
        wm.ext.settings.set_boolean("tiling-mode-enabled", !tilingModeEnabled);
        if (tilingModeEnabled) {
          wm.floatAllWindows();
        } else {
          wm.unfloatAllWindows();
        }
        wm.renderTree(`tiling-mode-toggle ${!tilingModeEnabled}`);
      },

      GapSize: (action, ctx) => {
        const { wm } = ctx;
        let gapIncrement = wm.ext.settings.get_uint("window-gap-size-increment");
        let amount = action.amount;
        gapIncrement = gapIncrement + amount;
        if (gapIncrement < 0) gapIncrement = 0;
        if (gapIncrement > 32) gapIncrement = 32;
        wm.ext.settings.set_uint("window-gap-size-increment", gapIncrement);
      },

      WindowResetSizes: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        if (focusNodeWindow && focusNodeWindow.parentNode) {
          wm.tree.resetSiblingPercent(focusNodeWindow.parentNode);
          if (focusNodeWindow.parentNode.parentNode) {
            wm.tree.resetSiblingPercent(focusNodeWindow.parentNode.parentNode);
          }
          wm.renderTree("window-reset-sizes");
        }
      },

      WorkspaceActiveTileToggle: (action, ctx) => {
        const { wm } = ctx;
        let activeWorkspace = global.workspace_manager.get_active_workspace_index();
        let skippedWorkspaces = wm.ext.settings.get_string("workspace-skip-tile");
        let skippedArr = skippedWorkspaces.length === 0 ? [] : skippedWorkspaces.split(",");

        if (wm._isWorkspaceSkipped(activeWorkspace)) {
          skippedArr.splice(skippedArr.indexOf(`${activeWorkspace}`), 1);
          wm.unfloatWorkspace(activeWorkspace);
        } else {
          skippedArr.push(`${activeWorkspace}`);
          wm.floatWorkspace(activeWorkspace);
        }
        wm.ext.settings.set_string("workspace-skip-tile", skippedArr.toString());
        wm.renderTree("workspace-toggle");
      },

      LayoutStackedToggle: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        if (!focusNodeWindow) return;
        if (!wm.ext.settings.get_boolean("stacked-tiling-mode-enabled")) return;

        if (focusNodeWindow.parentNode.isMonitor()) {
          wm.tree.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
        }

        let currentLayout = focusNodeWindow.parentNode.layout;

        if (currentLayout === LAYOUT_TYPES.STACKED) {
          focusNodeWindow.parentNode.layout = wm.determineSplitLayout();
          wm.tree.resetSiblingPercent(focusNodeWindow.parentNode);
        } else {
          if (currentLayout === LAYOUT_TYPES.TABBED) {
            focusNodeWindow.parentNode.lastTabFocus = null;
          }
          focusNodeWindow.parentNode.layout = LAYOUT_TYPES.STACKED;
          let lastChild = focusNodeWindow.parentNode.lastChild;
          if (lastChild.nodeType === NODE_TYPES.WINDOW) {
            lastChild.nodeValue.activate(global.display.get_current_time());
          }
        }
        wm.unfreezeRender();
        wm.tree.attachNode = focusNodeWindow.parentNode;
        wm.renderTree("layout-stacked-toggle");
      },

      LayoutTabbedToggle: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        if (!focusNodeWindow) return;
        if (!wm.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

        if (focusNodeWindow.parentNode.isMonitor()) {
          wm.tree.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
        }

        let currentLayout = focusNodeWindow.parentNode.layout;

        if (currentLayout === LAYOUT_TYPES.TABBED) {
          focusNodeWindow.parentNode.layout = wm.determineSplitLayout();
          wm.tree.resetSiblingPercent(focusNodeWindow.parentNode);
          focusNodeWindow.parentNode.lastTabFocus = null;
        } else {
          focusNodeWindow.parentNode.layout = LAYOUT_TYPES.TABBED;
          focusNodeWindow.parentNode.lastTabFocus = focusNodeWindow.nodeValue;
        }
        wm.unfreezeRender();
        wm.tree.attachNode = focusNodeWindow.parentNode;
        wm.renderTree("layout-tabbed-toggle");
      },

      PrefsOpen: (action, ctx) => {
        const { wm } = ctx;
        let existWindow = Utils.findWindowWith(wm.prefsTitle);
        if (existWindow && existWindow.get_workspace()) {
          existWindow
            .get_workspace()
            .activate_with_focus(existWindow, global.display.get_current_time());
          wm.moveCenter(existWindow);
        } else {
          wm.ext.openPreferences();
        }
      },

      ConfigReload: (action, ctx) => {
        const { wm } = ctx;
        // Keep live per-window (wmId) FloatToggle overrides from this session (forge-8rm6).
        wm.reloadWindowOverrides(false);
        // Also reimport settings and keybindings if portable config is enabled
        if (wm.ext.configSync) {
          wm.ext.configSync.importAll();
          Logger.info("Configuration and portable settings reloaded from files");
        } else {
          Logger.info("Window configuration reloaded from files");
        }
      },

      ConfigExport: (action, ctx) => {
        const { wm } = ctx;
        if (wm.ext.configSync) {
          wm.ext.configSync.enablePortableConfig();
          Logger.info("Configuration exported to portable config files");
        }
      },

      MovePointerToFocus: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        if (focusNodeWindow) {
          wm.movePointerWith(focusNodeWindow, { force: true });
        }
      },

      WorkspaceMonocleToggle: (action, ctx) => {
        const { wm } = ctx;
        wm.toggleWorkspaceMonocle();
      },

      WindowSwapLastActive: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        if (focusNodeWindow) {
          let lastActiveWindow = global.display.get_tab_next(
            Meta.TabList.NORMAL,
            global.display.get_workspace_manager().get_active_workspace(),
            focusNodeWindow.nodeValue,
            false
          );
          let lastActiveNodeWindow = wm.tree.findNode(lastActiveWindow);
          wm.tree.swapPairs(lastActiveNodeWindow, focusNodeWindow);
          wm.movePointerWith(focusNodeWindow);
          wm.renderTree("swap-last-active");
        }
      },

      SnapLayoutMove: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        // forge-9s8c: guard-clause + early return so a falsy focus can't fall
        // through into the next handler (ShowTabDecorationToggle).
        // NOTE: the inner switch's `break`s stay as `break` (they exit the inner
        // switch, not the handler).
        if (!focusNodeWindow) return;
        let workareaRect = Utils.getWorkAreaSafe(focusNodeWindow.nodeValue);
        if (!workareaRect) return;
        let layoutAmount = action.amount;
        let layoutDirection = action.direction.toUpperCase();
        let layout = {};
        let processGap = false;

        switch (layoutDirection) {
          case "LEFT":
            layout.width = layoutAmount * workareaRect.width;
            layout.height = workareaRect.height;
            layout.x = workareaRect.x;
            layout.y = workareaRect.y;
            processGap = true;
            break;
          case "RIGHT":
            layout.width = layoutAmount * workareaRect.width;
            layout.height = workareaRect.height;
            layout.x = workareaRect.x + (workareaRect.width - layout.width);
            layout.y = workareaRect.y;
            processGap = true;
            break;
          case "CENTER":
            let metaRect = wm.focusMetaWindow.get_frame_rect();
            layout.x = "center";
            layout.y = "center";
            layout = {
              x: Utils.resolveX(layout, wm.focusMetaWindow),
              y: Utils.resolveY(layout, wm.focusMetaWindow),
              width: metaRect.width,
              height: metaRect.height,
            };
            break;
          default:
            break;
        }
        focusNodeWindow.rect = layout;
        if (processGap) {
          focusNodeWindow.rect = wm.tree.processGap(focusNodeWindow);
        }
        if (!focusNodeWindow.isFloat()) {
          // Snap floats THIS window instance only (withWmId=true), matching how
          // windowDestroy cleans it up. Using a class-wide override (false) leaked
          // a persistent float for the whole wm_class that windowDestroy's
          // per-window removeFloatOverride could never clear (forge-qh2/forge-fc6).
          wm.addFloatOverride(focusNodeWindow.nodeValue, true);
        }
        wm.move(focusNodeWindow.nodeValue, focusNodeWindow.rect);
        wm.queueEvent({
          name: "snap-layout-move",
          callback: () => {
            wm.renderTree("snap-layout-move");
          },
        });
      },

      ShowTabDecorationToggle: (action, ctx) => {
        const { wm, focusNodeWindow } = ctx;
        if (!focusNodeWindow) return;
        if (!wm.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

        let showTabs = wm.ext.settings.get_boolean("showtab-decoration-enabled");
        wm.ext.settings.set_boolean("showtab-decoration-enabled", !showTabs);

        wm.unfreezeRender();
        wm.tree.attachNode = focusNodeWindow.parentNode;
        wm.renderTree("showtab-decoration-enabled");
      },

      WindowResizeRight: (action, ctx) => {
        ctx.wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_E, action.amount);
      },

      WindowResizeLeft: (action, ctx) => {
        ctx.wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_W, action.amount);
      },

      WindowResizeTop: (action, ctx) => {
        ctx.wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_N, action.amount);
      },

      WindowResizeBottom: (action, ctx) => {
        ctx.wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_S, action.amount);
      },

      // forge-gm0z: the old four overlapping wm.resize() grabs all clobbered the
      // single shared this.grabOp, so only RESIZING_E survived and the window
      // never grew/shrank vertically. wm.expand/shrink adjust percents directly
      // on both axes, bypassing the async grab/signal machinery.
      WindowExpand: (action, ctx) => {
        ctx.wm.expand(action.amount);
      },

      WindowShrink: (action, ctx) => {
        ctx.wm.shrink(action.amount);
      },

      // forge-zlg: resize the focused window to the golden-ratio share of its
      // split, on demand. Single-axis and absolute (not a pixel delta like
      // expand/shrink), so it doesn't fight manual resize.
      WindowGoldenRatio: (action, ctx) => {
        ctx.wm.applyGoldenRatio();
      },
    };
  }
}
