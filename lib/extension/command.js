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
import { WINDOW_MODES } from "./window.js";
import * as Utils from "./utils.js";

/**
 * CommandHandler processes keyboard and action commands for the window manager.
 * Extracted from window.js to consolidate command logic.
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
  }

  /**
   * Execute a command action
   * @param {Object} action - The action to execute
   * @param {string} action.name - The command name
   */
  execute(action) {
    const wm = this._extWm;
    let focusWindow = wm.focusMetaWindow;
    let focusNodeWindow = wm.findNodeWindow(focusWindow);
    let currentLayout;

    switch (action.name) {
      case "FloatNonPersistentToggle":
      case "FloatToggle":
      case "FloatClassToggle":
        wm.toggleFloatingMode(action, focusWindow);

        const rectRequest = {
          x: action.x,
          y: action.y,
          width: action.width,
          height: action.height,
        };

        let moveRect = {
          x: Utils.resolveX(rectRequest, focusWindow),
          y: Utils.resolveY(rectRequest, focusWindow),
          width: Utils.resolveWidth(rectRequest, focusWindow),
          height: Utils.resolveHeight(rectRequest, focusWindow),
        };

        wm.move(focusWindow, moveRect);

        let existParent = focusNodeWindow.parentNode;

        if (wm.tree.getTiledChildren(existParent.childNodes).length <= 1) {
          existParent.percent = 0.0;
          wm.tree.resetSiblingPercent(existParent.parentNode);
        }

        wm.tree.resetSiblingPercent(existParent);
        wm.renderTree("float-toggle", true);
        break;

      case "Move":
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
              if (focusNodeWindow.parentNode.layout === LAYOUT_TYPES.STACKED) {
                focusNodeWindow.parentNode.appendChild(focusNodeWindow);
                focusNodeWindow.nodeValue.raise();
                focusNodeWindow.nodeValue.activate(global.display.get_current_time());
                wm.renderTree("move-stacked-queue");
              }
              if (focusNodeWindow.parentNode.layout === LAYOUT_TYPES.TABBED) {
                focusNodeWindow.nodeValue.raise();
                focusNodeWindow.nodeValue.activate(global.display.get_current_time());
                if (prev) prev.parentNode.lastTabFocus = prev.nodeValue;
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
        break;

      case "Focus":
        let focusDirection = Utils.resolveDirection(action.direction);
        focusNodeWindow = wm.tree.focus(focusNodeWindow, focusDirection);
        if (!focusNodeWindow) {
          focusNodeWindow = wm.findNodeWindow(wm.focusMetaWindow);
        }
        wm.updateStackedFocus(focusNodeWindow);
        wm.updateTabbedFocus(focusNodeWindow);
        break;

      case "Swap":
        if (!focusNodeWindow) return;
        wm.unfreezeRender();
        let swapDirection = Utils.resolveDirection(action.direction);
        wm.tree.swap(focusNodeWindow, swapDirection);
        focusNodeWindow.nodeValue.raise();
        wm.updateTabbedFocus(focusNodeWindow);
        wm.updateStackedFocus(focusNodeWindow);
        wm.movePointerWith(focusNodeWindow);
        wm.renderTree("swap", true);
        break;

      case "Split":
        if (!focusNodeWindow) return;
        currentLayout = focusNodeWindow.parentNode.layout;
        if (currentLayout === LAYOUT_TYPES.STACKED || currentLayout === LAYOUT_TYPES.TABBED) {
          return;
        }
        let orientation = action.orientation
          ? action.orientation.toUpperCase()
          : ORIENTATION_TYPES.NONE;
        wm.tree.split(focusNodeWindow, orientation);
        wm.applyDefaultLayoutToContainer(focusNodeWindow.parentNode);
        wm.renderTree("split");
        break;

      case "LayoutToggle":
        if (!focusNodeWindow) return;
        currentLayout = focusNodeWindow.parentNode.layout;
        if (currentLayout === LAYOUT_TYPES.HSPLIT) {
          focusNodeWindow.parentNode.layout = LAYOUT_TYPES.VSPLIT;
        } else if (currentLayout === LAYOUT_TYPES.VSPLIT) {
          focusNodeWindow.parentNode.layout = LAYOUT_TYPES.HSPLIT;
        }
        wm.tree.attachNode = focusNodeWindow.parentNode;
        wm.renderTree("layout-split-toggle");
        break;

      case "FocusBorderToggle":
        let focusBorderEnabled = wm.ext.settings.get_boolean("focus-border-toggle");
        wm.ext.settings.set_boolean("focus-border-toggle", !focusBorderEnabled);
        break;

      case "TilingModeToggle":
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
        break;

      case "GapSize":
        let gapIncrement = wm.ext.settings.get_uint("window-gap-size-increment");
        let amount = action.amount;
        gapIncrement = gapIncrement + amount;
        if (gapIncrement < 0) gapIncrement = 0;
        if (gapIncrement > 32) gapIncrement = 32;
        wm.ext.settings.set_uint("window-gap-size-increment", gapIncrement);
        break;

      case "WindowResetSizes":
        if (focusNodeWindow && focusNodeWindow.parentNode) {
          wm.tree.resetSiblingPercent(focusNodeWindow.parentNode);
          if (focusNodeWindow.parentNode.parentNode) {
            wm.tree.resetSiblingPercent(focusNodeWindow.parentNode.parentNode);
          }
          wm.renderTree("window-reset-sizes");
        }
        break;

      case "WorkspaceActiveTileToggle":
        let activeWorkspace = global.workspace_manager.get_active_workspace_index();
        let skippedWorkspaces = wm.ext.settings.get_string("workspace-skip-tile");
        let workspaceSkipped = false;
        let skippedArr = [];
        if (skippedWorkspaces.length === 0) {
          skippedArr.push(`${activeWorkspace}`);
          wm.floatWorkspace(activeWorkspace);
        } else {
          skippedArr = skippedWorkspaces.split(",");

          for (let i = 0; i < skippedArr.length; i++) {
            if (`${skippedArr[i]}` === `${activeWorkspace}`) {
              workspaceSkipped = true;
              break;
            }
          }

          if (workspaceSkipped) {
            let indexWs = skippedArr.indexOf(`${activeWorkspace}`);
            skippedArr.splice(indexWs, 1);
            wm.unfloatWorkspace(activeWorkspace);
          } else {
            skippedArr.push(`${activeWorkspace}`);
            wm.floatWorkspace(activeWorkspace);
          }
        }
        wm.ext.settings.set_string("workspace-skip-tile", skippedArr.toString());
        wm.renderTree("workspace-toggle");
        break;

      case "LayoutStackedToggle":
        if (!focusNodeWindow) return;
        if (!wm.ext.settings.get_boolean("stacked-tiling-mode-enabled")) return;

        if (focusNodeWindow.parentNode.isMonitor()) {
          wm.tree.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
        }

        currentLayout = focusNodeWindow.parentNode.layout;

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
        break;

      case "LayoutTabbedToggle":
        if (!focusNodeWindow) return;
        if (!wm.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

        if (focusNodeWindow.parentNode.isMonitor()) {
          wm.tree.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
        }

        currentLayout = focusNodeWindow.parentNode.layout;

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
        break;

      case "CancelOperation":
        if (focusNodeWindow.mode === WINDOW_MODES.GRAB_TILE) {
          wm.cancelGrab = true;
        }
        break;

      case "PrefsOpen":
        let existWindow = Utils.findWindowWith(wm.prefsTitle);
        if (existWindow && existWindow.get_workspace()) {
          existWindow
            .get_workspace()
            .activate_with_focus(existWindow, global.display.get_current_time());
          wm.moveCenter(existWindow);
        } else {
          wm.ext.openPreferences();
        }
        break;

      case "ConfigReload":
        wm.reloadWindowOverrides();
        // Also reimport settings and keybindings if portable config is enabled
        if (wm.ext.configSync) {
          wm.ext.configSync.importAll();
          Logger.info("Configuration and portable settings reloaded from files");
        } else {
          Logger.info("Window configuration reloaded from files");
        }
        break;

      case "ConfigExport":
        if (wm.ext.configSync) {
          wm.ext.configSync.enablePortableConfig();
          Logger.info("Configuration exported to portable config files");
        }
        break;

      case "MovePointerToFocus":
        if (focusNodeWindow) {
          wm.movePointerWith(focusNodeWindow, { force: true });
        }
        break;

      case "WorkspaceMonocleToggle":
        wm.toggleWorkspaceMonocle();
        break;

      case "WindowSwapLastActive":
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
        break;

      case "SnapLayoutMove":
        if (focusNodeWindow) {
          let workareaRect = focusNodeWindow.nodeValue.get_work_area_current_monitor();
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
            wm.addFloatOverride(focusNodeWindow.nodeValue, false);
          }
          wm.move(focusNodeWindow.nodeValue, focusNodeWindow.rect);
          wm.queueEvent({
            name: "snap-layout-move",
            callback: () => {
              wm.renderTree("snap-layout-move");
            },
          });
          break;
        }

      case "ShowTabDecorationToggle":
        if (!focusNodeWindow) return;
        if (!wm.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

        let showTabs = wm.ext.settings.get_boolean("showtab-decoration-enabled");
        wm.ext.settings.set_boolean("showtab-decoration-enabled", !showTabs);

        wm.unfreezeRender();
        wm.tree.attachNode = focusNodeWindow.parentNode;
        wm.renderTree("showtab-decoration-enabled");
        break;

      case "WindowResizeRight":
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_E, action.amount);
        break;

      case "WindowResizeLeft":
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_W, action.amount);
        break;

      case "WindowResizeTop":
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_N, action.amount);
        break;

      case "WindowResizeBottom":
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_S, action.amount);
        break;

      case "WindowExpand":
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_N, action.amount);
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_S, action.amount);
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_W, action.amount);
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_E, action.amount);
        break;

      case "WindowShrink":
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_N, -action.amount);
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_S, -action.amount);
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_W, -action.amount);
        wm.resize(Meta.GrabOp.KEYBOARD_RESIZING_E, -action.amount);
        break;

      default:
        break;
    }
  }
}
