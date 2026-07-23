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
import St from "gi://St";

// Shared state
import { Logger } from "../shared/logger.js";

// App imports
import * as Utils from "./utils.js";
import { NODE_TYPES } from "./tree.js";
import * as Compat from "./compat.js";

/**
 * DecorationManager owns the decoration/border rendering for tiled windows.
 * Extracted from window.js (WindowManager) to keep the rendering cluster in one
 * place. Shared WindowManager state (_freezeRender, focusMetaWindow, currentWsNode,
 * ext.settings, calculate'd helpers) is read LIVE via this._extWm so behavior is
 * preserved. _alignToBufferScale intentionally stays on WindowManager (also used by
 * move()) and is invoked through this._extWm.
 */
export class DecorationManager extends GObject.Object {
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

  hideActorBorder(actor) {
    // Ensure borders are hidden regardless of state (#268)
    if (actor && actor.border) {
      try {
        actor.border.hide();
      } catch (e) {
        Logger.warn(`Failed to hide border: ${e}`);
      }
    }
    if (actor && actor.splitBorder) {
      try {
        actor.splitBorder.hide();
      } catch (e) {
        Logger.warn(`Failed to hide splitBorder: ${e}`);
      }
    }
  }

  hideWindowBorders() {
    // Ensure we iterate even if tree is in unexpected state (#268)
    const nodeWindows = this._tree.nodeWindows || [];
    nodeWindows.forEach((nodeWindow) => {
      let actor = nodeWindow.windowActor;
      if (actor) {
        this._extWm.hideActorBorder(actor);
      }
      if (nodeWindow.parentNode && nodeWindow.parentNode.isStackedOrTabbed()) {
        if (nodeWindow.tab && !nodeWindow.tab._destroyed && nodeWindow.tab.get_parent()) {
          nodeWindow.tab.remove_style_class_name("window-tabbed-tab-active");
        }
      }
    });
  }

  showWindowBorders() {
    let metaWindow = this._extWm.focusMetaWindow;
    if (!metaWindow) return;
    let windowActor = metaWindow.get_compositor_private();
    if (!windowActor) return;
    let nodeWindow = this._extWm.findNodeWindow(metaWindow);
    if (!nodeWindow) return;
    if (metaWindow.get_wm_class() === null) return;

    let borders = [];
    let focusBorderEnabled = this._extWm.ext.settings.get_boolean("focus-border-toggle");
    let focusBorderHiddenOnSingle = this._extWm.ext.settings.get_boolean(
      "focus-border-hidden-on-single"
    );
    let splitBorderEnabled = this._extWm.ext.settings.get_boolean("split-border-toggle");
    let tilingModeEnabled = this._extWm.ext.settings.get_boolean("tiling-mode-enabled");
    let gap = this._extWm.calculateGaps(nodeWindow);
    let maximized = () => Compat.isMaximized(metaWindow) || metaWindow.is_fullscreen() || gap === 0;
    let monitorCount = global.display.get_n_monitors();
    let monitorNode = this._tree.findAncestorMonitor(nodeWindow);
    let tiledChildren = this._extWm._tiledWindowsOnMonitor(monitorNode);
    // forge-hcbz: the border's CSS border-width is scaled to physical px by St
    // (6 at 2x for the 3px default), but this inset positions the border actor in
    // physical coords — a raw 3 leaves the border painting over window content at
    // integer HiDPI. This 3px is only the fallback default; forge-8rm0 refines it
    // from the actual themed border-width once the style class is applied (below).
    let inset = 3 * Utils.dpi();
    let parentNode = nodeWindow.parentNode;

    const floatingWindow = nodeWindow.isFloat();
    const tiledBorder = windowActor.border;

    if (parentNode.isStackedOrTabbed()) {
      if (nodeWindow.tab) {
        nodeWindow.tab.add_style_class_name("window-tabbed-tab-active");
      }
    }

    // Feature #262: Skip focus border if single window and setting enabled
    let isSingleWindow = tiledChildren.length === 1 && monitorCount === 1;
    let skipBorderForSingle = focusBorderHiddenOnSingle && isSingleWindow && !floatingWindow;

    if (tiledBorder && focusBorderEnabled && !skipBorderForSingle) {
      if (
        !maximized() ||
        (gap === 0 && tiledChildren.length === 1 && monitorCount > 1) ||
        (gap === 0 && tiledChildren.length > 1)
      ) {
        if (tilingModeEnabled) {
          if (parentNode.isStacked()) {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-stacked-border");
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          } else if (parentNode.isTabbed()) {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-tabbed-border");
              if (nodeWindow.backgroundTab) {
                tiledBorder.add_style_class_name("window-tabbed-bg");
              }
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          } else {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-tiled-border");
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          }
          borders.push(tiledBorder);
        }
        // Feature #297: Don't show floating border when tiling is disabled
      }
    }

    // forge-8rm0: the focus-border width is user-configurable in prefs (written to
    // the CSS stylesheet), but the inset hardcoded 3px so a wider ring overlapped
    // window content and a narrower one left a gap. Read the actual painted width
    // from the border actor's themed node (already scaled to physical px), like
    // tree.js _applyDecorationRect. Keep the 3px fallback when no width is themed.
    if (tiledBorder && tiledBorder.get_theme_node) {
      const themedWidth = tiledBorder.get_theme_node().get_border_width(St.Side.TOP);
      if (themedWidth > 0) inset = themedWidth;
    }

    if (gap === 0 || Compat.isMaximized(metaWindow)) {
      inset = 0;
    }

    // Show split direction indicator for windows in H/V-Split containers
    if (
      splitBorderEnabled &&
      focusBorderEnabled &&
      tilingModeEnabled &&
      !nodeWindow.isFloat() &&
      !maximized() && // Bug #407/#409 fix: maximized is a function, call it
      (parentNode.isCon() || parentNode.isMonitor()) &&
      !parentNode.isStackedOrTabbed()
    ) {
      if (!windowActor.splitBorder) {
        let splitBorder = new St.Bin({ style_class: "window-split-border" });
        global.window_group.add_child(splitBorder);
        windowActor.splitBorder = splitBorder;
      }

      let splitBorder = windowActor.splitBorder;
      splitBorder.remove_style_class_name("window-split-vertical");
      splitBorder.remove_style_class_name("window-split-horizontal");

      if (parentNode.isVSplit()) {
        splitBorder.add_style_class_name("window-split-vertical");
      } else if (parentNode.isHSplit()) {
        splitBorder.add_style_class_name("window-split-horizontal");
      }
      borders.push(splitBorder);
    }

    let rect = metaWindow.get_frame_rect();

    // Bug #164 fix: align the border rect to buffer scale on Wayland HiDPI, the
    // same alignment move() applies to the window itself (see _alignToBufferScale).
    // Without this the border is sourced from the unaligned frame rect and ends up
    // offset/smaller than the window it outlines on fractional/2x scaling.
    if (rect && Meta.is_wayland_compositor && Meta.is_wayland_compositor()) {
      const scale = Utils.dpi();
      if (scale > 1) {
        rect = {
          x: this._extWm._alignToBufferScale(rect.x, scale),
          y: this._extWm._alignToBufferScale(rect.y, scale),
          width: this._extWm._alignToBufferScale(rect.width, scale),
          height: this._extWm._alignToBufferScale(rect.height, scale),
        };
      }
    }

    // Bug #164 fix: Validate rect has valid dimensions before setting border size
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    // forge-36le pins the split hint's corners square (St won't paint a one-sided
    // border otherwise), so its single drawn edge overshoots the focus border's
    // rounded corners. Shorten that edge along its long axis by the focus border
    // radius at each end so it ends inside the straight portion; the cross axis stays
    // flush with the focus border. The maximized/gap==0 case (inset 0) never reaches
    // here — the split border guard above excludes it.
    const splitBorder = windowActor.splitBorder;
    const splitRadius = this._extWm.ext.settings.get_uint("focus-border-radius") * Utils.dpi();

    borders.forEach((border) => {
      if (border === splitBorder) {
        let x = rect.x - inset;
        let y = rect.y - inset;
        let width = rect.width + inset * 2;
        let height = rect.height + inset * 2;
        if (parentNode.isVSplit()) {
          // bottom edge: shorten horizontally
          x += splitRadius;
          width -= splitRadius * 2;
        } else if (parentNode.isHSplit()) {
          // right edge: shorten vertically
          y += splitRadius;
          height -= splitRadius * 2;
        }
        border.set_size(Math.max(width, 1), Math.max(height, 1));
        border.set_position(x, y);
        if (metaWindow.appears_focused && !metaWindow.minimized) {
          border.show();
        }
        if (global.window_group && global.window_group.contains(border)) {
          global.window_group.remove_child(border);
          let compositor = metaWindow.get_compositor_private();
          if (compositor) {
            global.window_group.insert_child_above(border, compositor);
          }
        }
        return;
      }
      // Ensure positive dimensions after inset adjustment
      const width = Math.max(rect.width + inset * 2, 1);
      const height = Math.max(rect.height + inset * 2, 1);
      border.set_size(width, height);
      border.set_position(rect.x - inset, rect.y - inset);
      if (metaWindow.appears_focused && !metaWindow.minimized) {
        border.show();
      }
      if (global.window_group && global.window_group.contains(border)) {
        global.window_group.remove_child(border);
        let compositor = metaWindow.get_compositor_private();
        if (compositor) {
          global.window_group.insert_child_above(border, compositor);
        }
      }
    });

    // Ensure split border is rendered on top of tiled border
    if (
      windowActor.splitBorder &&
      windowActor.border &&
      global.window_group &&
      global.window_group.contains(windowActor.splitBorder) &&
      global.window_group.contains(windowActor.border)
    ) {
      global.window_group.set_child_above_sibling(windowActor.splitBorder, windowActor.border);
    }
  }

  updateBorderLayout() {
    this._extWm.hideWindowBorders();
    this._extWm.showWindowBorders();
  }

  calculateGaps(node) {
    if (!node) return 0;

    let settings = this._extWm.ext.settings;
    let gapSize = settings.get_uint("window-gap-size");
    let gapIncrement = settings.get_uint("window-gap-size-increment");
    // forge-2s37: gaps are applied to physical-pixel work-area rects, so scale the
    // logical gap setting by dpi() — otherwise gaps visually halve at integer HiDPI
    // while tab bars/borders on the same screen stay dpi-scaled. (Margins/resize-amount
    // are left unscaled: separate, intent-ambiguous settings.)
    let gap = gapSize * gapIncrement * Utils.dpi();

    if (!node.isRoot()) {
      let hideGapWhenSingle = settings.get_boolean("window-gap-hidden-on-single");
      let parentNode = this._tree.findAncestorMonitor(node);
      if (parentNode) {
        let tiled = this._extWm._tiledWindowsOnMonitor(parentNode);
        if (tiled.length == 1 && hideGapWhenSingle) gap = 0;
      }
    }

    return gap;
  }

  _destroyActorBorder(actor, propName) {
    const border = actor[propName];
    if (border && global.window_group) {
      global.window_group.remove_child(border);
      border.hide();
    }
  }

  updateDecorationLayout() {
    if (this._extWm._freezeRender) return;
    let activeWsNode = this._extWm.currentWsNode;
    let allCons = this._tree.getNodeByType(NODE_TYPES.CON);

    allCons.forEach((con) => {
      if (con.decoration) {
        con.decoration.hide();
      }
    });

    // Next, handle showing-desktop usually by Super + D
    if (!activeWsNode) return;
    // forge-e5mh: invoked pre-prune from raw signal handlers, so a finalized
    // wrapper's showing_on_its_workspace()/minimized/is_fullscreen() would throw
    // and abort the relayout (tab/stack bars vanish, workspace not re-rendered).
    // Drop dead windows up front so both filters below are consistent.
    let allWindows = activeWsNode
      .getNodeByType(NODE_TYPES.WINDOW)
      .filter((w) => Utils.isWindowAlive(w.nodeValue));
    let allHiddenWindows = allWindows.filter((w) => {
      let metaWindow = w.nodeValue;
      return !metaWindow.showing_on_its_workspace() || metaWindow.minimized;
    });

    if (allWindows.length === allHiddenWindows.length) return;

    // Show the decoration where on all monitors of active workspace
    // But not on the monitor where there is a maximized or fullscreen window
    // Note, that when multi-display, user can have multi maximized windows,
    // So it needs to be fully filtered:
    let monWsNoMaxWindows = activeWsNode.getNodeByType(NODE_TYPES.MONITOR).filter((monitor) => {
      return (
        monitor
          .getNodeByType(NODE_TYPES.WINDOW)
          // forge-iwi: a minimized maximized/fullscreen window covers nothing, so
          // it must not keep tab/stack decorations hidden (they never returned).
          .filter(
            (w) =>
              // forge-e5mh: guard against finalized wrappers here too.
              Utils.isWindowAlive(w.nodeValue) &&
              !w.nodeValue.minimized &&
              (Compat.isMaximized(w.nodeValue) || w.nodeValue.is_fullscreen())
          ).length === 0
      );
    });

    monWsNoMaxWindows.forEach((monitorWs) => {
      let activeMonWsCons = monitorWs.getNodeByType(NODE_TYPES.CON);
      activeMonWsCons.forEach((con) => {
        let tiled = this._tree.getTiledChildren(con.childNodes);
        let showTabs = this._extWm.ext.settings.get_boolean("showtab-decoration-enabled");
        if (con.decoration && tiled.length > 0 && showTabs) {
          con.decoration.show();
          if (global.window_group.contains(con.decoration) && this._extWm.focusMetaWindow) {
            global.window_group.remove_child(con.decoration);
            global.window_group.insert_child_below(
              con.decoration,
              this._extWm.focusMetaWindow.get_compositor_private()
            );
          }
          con.childNodes.forEach((cn) => {
            cn.render();
          });
        }
      });
    });
  }
}
