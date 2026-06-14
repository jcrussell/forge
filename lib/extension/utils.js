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
 * Credits:
 * This file has some code from Dash-To-Panel extension: convenience.js
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

// Gnome imports
import Meta from "gi://Meta";
import St from "gi://St";

// Gnome-shell imports
import { PACKAGE_VERSION } from "resource:///org/gnome/shell/misc/config.js";

// App imports
import { createEnum } from "./enum.js";
import { ORIENTATION_TYPES, LAYOUT_TYPES, POSITION } from "./tree.js";
import { GRAB_TYPES } from "./window.js";

const [major] = PACKAGE_VERSION.split(".").map((s) => Number(s));

// Drop zones for drag-and-drop tiling
export const DROP_ZONES = createEnum(["LEFT", "RIGHT", "TOP", "BOTTOM", "CENTER", "NONE"]);

/**
 * mutter aborts (g_assert) inside get_work_area_current_monitor() when the window
 * has no logical monitor — e.g. a dialog mapped before placement, or during a
 * monitors-changed transition. get_monitor() returns -1 in exactly that case, so
 * gate on it. Returns null when the window has no usable monitor.
 */
export function getWorkAreaSafe(metaWindow) {
  if (!metaWindow || metaWindow.get_monitor() < 0) return null;
  return metaWindow.get_work_area_current_monitor();
}

export function resolveX(rectRequest, metaWindow) {
  let metaRect = metaWindow.get_frame_rect();
  let monitorRect = getWorkAreaSafe(metaWindow);
  let val = metaRect.x;
  if (!monitorRect) return val;
  let x = rectRequest.x;
  switch (typeof x) {
    case "string": //center,
      switch (x) {
        case "center":
          val = monitorRect.width * 0.5 - resolveWidth(rectRequest, metaWindow) * 0.5;
          break;
        case "left":
          val = 0;
          break;
        case "right":
          val = monitorRect.width - resolveWidth(rectRequest, metaWindow);
          break;
        default:
          break;
      }
      break;
    case "number":
      val = x;
      break;
    default:
      break;
  }
  val = monitorRect.x + val;
  return val;
}

export function resolveY(rectRequest, metaWindow) {
  let metaRect = metaWindow.get_frame_rect();
  let monitorRect = getWorkAreaSafe(metaWindow);
  let val = metaRect.y;
  if (!monitorRect) return val;
  let y = rectRequest.y;
  switch (typeof y) {
    case "string": //center,
      switch (y) {
        case "center":
          val = monitorRect.height * 0.5 - resolveHeight(rectRequest, metaWindow) * 0.5;
          break;
        case "top":
          val = 0;
          break;
        case "bottom": // inverse of y=0
          val = monitorRect.height - resolveHeight(rectRequest, metaWindow);
          break;
        default:
          break;
      }
      break;
    case "number":
      val = y;
      break;
    default:
      break;
  }
  val = monitorRect.y + val;
  return val;
}

export function resolveWidth(rectRequest, metaWindow) {
  let metaRect = metaWindow.get_frame_rect();
  let monitorRect = getWorkAreaSafe(metaWindow);
  let val = metaRect.width;
  if (!monitorRect) return val;
  let width = rectRequest.width;
  switch (typeof width) {
    case "number":
      if (Number.isInteger(width) && width != 1) {
        val = width;
      } else {
        let monitorWidth = monitorRect.width;
        val = monitorWidth * width;
      }
      break;
    default:
      break;
  }
  return val;
}

export function resolveHeight(rectRequest, metaWindow) {
  let metaRect = metaWindow.get_frame_rect();
  let monitorRect = getWorkAreaSafe(metaWindow);
  let val = metaRect.height;
  if (!monitorRect) return val;
  let height = rectRequest.height;
  switch (typeof height) {
    case "number":
      if (Number.isInteger(height) && height != 1) {
        val = height;
      } else {
        let monitorHeight = monitorRect.height;
        val = monitorHeight * height;
      }
      break;
    default:
      break;
  }
  return val;
}

export function resolveRect(rectRequest, metaWindow) {
  return {
    x: resolveX(rectRequest, metaWindow),
    y: resolveY(rectRequest, metaWindow),
    width: resolveWidth(rectRequest, metaWindow),
    height: resolveHeight(rectRequest, metaWindow),
  };
}

export function orientationFromDirection(direction) {
  return direction === Meta.MotionDirection.LEFT || direction === Meta.MotionDirection.RIGHT
    ? ORIENTATION_TYPES.HORIZONTAL
    : ORIENTATION_TYPES.VERTICAL;
}

export function orientationFromLayout(layout) {
  switch (layout) {
    case LAYOUT_TYPES.HSPLIT:
    case LAYOUT_TYPES.TABBED:
      return ORIENTATION_TYPES.HORIZONTAL;
    case LAYOUT_TYPES.VSPLIT:
    case LAYOUT_TYPES.STACKED:
      return ORIENTATION_TYPES.VERTICAL;
    default:
      break;
  }
}

export function positionFromDirection(direction) {
  return direction === Meta.MotionDirection.LEFT || direction === Meta.MotionDirection.UP
    ? POSITION.BEFORE
    : POSITION.AFTER;
}

const DIRECTION_STRING_MAP = {
  LEFT: Meta.MotionDirection.LEFT,
  RIGHT: Meta.MotionDirection.RIGHT,
  UP: Meta.MotionDirection.UP,
  DOWN: Meta.MotionDirection.DOWN,
};

export function resolveDirection(directionString) {
  if (directionString) {
    return DIRECTION_STRING_MAP[directionString.toUpperCase()] ?? null;
  }
  return null;
}

export function directionFrom(position, orientation) {
  if (position === POSITION.AFTER) {
    if (orientation === ORIENTATION_TYPES.HORIZONTAL) {
      return Meta.DisplayDirection.RIGHT;
    } else {
      return Meta.DisplayDirection.DOWN;
    }
  } else if (position === POSITION.BEFORE) {
    if (orientation === ORIENTATION_TYPES.HORIZONTAL) {
      return Meta.DisplayDirection.LEFT;
    } else {
      return Meta.DisplayDirection.UP;
    }
  }
}

export function rectContainsPoint(rect, pointP) {
  if (!(rect && pointP)) return false;
  return (
    rect.x <= pointP[0] &&
    pointP[0] <= rect.x + rect.width &&
    rect.y <= pointP[1] &&
    pointP[1] <= rect.y + rect.height
  );
}

/**
 * Whether two rectangles share any area (strict overlap, touching edges do not
 * count). Both rects use the {x, y, width, height} shape.
 */
export function rectsOverlap(a, b) {
  if (!(a && b)) return false;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

const VERTICAL_GRABS = new Set([
  Meta.GrabOp.RESIZING_N,
  Meta.GrabOp.RESIZING_S,
  Meta.GrabOp.KEYBOARD_RESIZING_N,
  Meta.GrabOp.KEYBOARD_RESIZING_S,
]);

const HORIZONTAL_GRABS = new Set([
  Meta.GrabOp.RESIZING_E,
  Meta.GrabOp.RESIZING_W,
  Meta.GrabOp.KEYBOARD_RESIZING_E,
  Meta.GrabOp.KEYBOARD_RESIZING_W,
]);

export function orientationFromGrab(grabOp) {
  if (VERTICAL_GRABS.has(grabOp)) return ORIENTATION_TYPES.VERTICAL;
  if (HORIZONTAL_GRABS.has(grabOp)) return ORIENTATION_TYPES.HORIZONTAL;
  return ORIENTATION_TYPES.NONE;
}

const BEFORE_GRABS = new Set([
  Meta.GrabOp.RESIZING_W,
  Meta.GrabOp.RESIZING_N,
  Meta.GrabOp.KEYBOARD_RESIZING_W,
  Meta.GrabOp.KEYBOARD_RESIZING_N,
]);

const AFTER_GRABS = new Set([
  Meta.GrabOp.RESIZING_E,
  Meta.GrabOp.RESIZING_S,
  Meta.GrabOp.KEYBOARD_RESIZING_E,
  Meta.GrabOp.KEYBOARD_RESIZING_S,
]);

export function positionFromGrabOp(grabOp) {
  if (BEFORE_GRABS.has(grabOp)) return POSITION.BEFORE;
  if (AFTER_GRABS.has(grabOp)) return POSITION.AFTER;
  return POSITION.UNKNOWN;
}

// Mask to strip META_GRAB_OP_WINDOW_FLAG_UNCONSTRAINED (bit 1024)
const GRAB_OP_UNCONSTRAINED_MASK = ~1024;

export function normalizeGrabOp(grabOp) {
  return grabOp & GRAB_OP_UNCONSTRAINED_MASK;
}

// All resize grab-ops recognized by Forge
const RESIZE_GRAB_OPS = new Set([
  Meta.GrabOp.RESIZING_N,
  Meta.GrabOp.RESIZING_E,
  Meta.GrabOp.RESIZING_W,
  Meta.GrabOp.RESIZING_S,
  Meta.GrabOp.RESIZING_NE,
  Meta.GrabOp.RESIZING_NW,
  Meta.GrabOp.RESIZING_SE,
  Meta.GrabOp.RESIZING_SW,
  Meta.GrabOp.KEYBOARD_RESIZING_N,
  Meta.GrabOp.KEYBOARD_RESIZING_E,
  Meta.GrabOp.KEYBOARD_RESIZING_W,
  Meta.GrabOp.KEYBOARD_RESIZING_S,
  Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN,
]);

export function allowResizeGrabOp(grabOp) {
  return RESIZE_GRAB_OPS.has(normalizeGrabOp(grabOp));
}

export function grabMode(grabOp) {
  grabOp = normalizeGrabOp(grabOp);
  if (RESIZE_GRAB_OPS.has(grabOp)) {
    return GRAB_TYPES.RESIZING;
  } else if (
    grabOp === Meta.GrabOp.KEYBOARD_MOVING ||
    grabOp === Meta.GrabOp.MOVING ||
    grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED
  ) {
    return GRAB_TYPES.MOVING;
  }
  return GRAB_TYPES.UNKNOWN;
}

export function decomposeGrabOp(grabOp) {
  grabOp = normalizeGrabOp(grabOp);
  switch (grabOp) {
    case Meta.GrabOp.RESIZING_NE:
      return [Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_E];
    case Meta.GrabOp.RESIZING_NW:
      return [Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_W];
    case Meta.GrabOp.RESIZING_SE:
      return [Meta.GrabOp.RESIZING_S, Meta.GrabOp.RESIZING_E];
    case Meta.GrabOp.RESIZING_SW:
      return [Meta.GrabOp.RESIZING_S, Meta.GrabOp.RESIZING_W];
    default:
      return [grabOp];
  }
}

const GRAB_TO_DIRECTION = new Map([
  [Meta.GrabOp.RESIZING_E, Meta.MotionDirection.RIGHT],
  [Meta.GrabOp.KEYBOARD_RESIZING_E, Meta.MotionDirection.RIGHT],
  [Meta.GrabOp.RESIZING_W, Meta.MotionDirection.LEFT],
  [Meta.GrabOp.KEYBOARD_RESIZING_W, Meta.MotionDirection.LEFT],
  [Meta.GrabOp.RESIZING_N, Meta.MotionDirection.UP],
  [Meta.GrabOp.KEYBOARD_RESIZING_N, Meta.MotionDirection.UP],
  [Meta.GrabOp.RESIZING_S, Meta.MotionDirection.DOWN],
  [Meta.GrabOp.KEYBOARD_RESIZING_S, Meta.MotionDirection.DOWN],
]);

export function directionFromGrab(grabOp) {
  return GRAB_TO_DIRECTION.get(grabOp);
}

export function removeGapOnRect(rectWithGap, gap) {
  rectWithGap.x -= gap;
  rectWithGap.y -= gap;
  rectWithGap.width += gap * 2;
  rectWithGap.height += gap * 2;
  return rectWithGap;
}

/**
 * A destroyed MetaWindow's GJS wrapper throws on any method call once
 * finalized ("Object Meta.Window ... has been already deallocated");
 * probe with get_id(). Null/undefined are dead by definition. Note the
 * probe cannot detect a disposed-but-not-yet-finalized wrapper - callers
 * should pair it with a structural check (e.g. the node's parentNode).
 */
export function isWindowAlive(metaWindow) {
  if (!metaWindow) return false;
  try {
    metaWindow.get_id();
    return true;
  } catch (e) {
    return false;
  }
}

// Credits: PopShell
export function findWindowWith(title) {
  let display = global.display;
  let type = Meta.TabList.NORMAL_ALL;
  let workspaceMgr = display.get_workspace_manager();
  let workspaces = workspaceMgr.get_n_workspaces();

  for (let wsId = 1; wsId <= workspaces; wsId++) {
    let workspace = workspaceMgr.get_workspace_by_index(wsId);
    for (const metaWindow of display.get_tab_list(type, workspace)) {
      if (
        metaWindow.title &&
        title &&
        (metaWindow.title === title || metaWindow.title.includes(title))
      ) {
        return metaWindow;
      }
    }
  }

  return undefined;
}

const OPPOSITE_DIRECTION_MAP = {
  [Meta.MotionDirection.LEFT]: Meta.MotionDirection.RIGHT,
  [Meta.MotionDirection.RIGHT]: Meta.MotionDirection.LEFT,
  [Meta.MotionDirection.UP]: Meta.MotionDirection.DOWN,
  [Meta.MotionDirection.DOWN]: Meta.MotionDirection.UP,
};

export function oppositeDirectionOf(direction) {
  return OPPOSITE_DIRECTION_MAP[direction];
}

export function monitorIndex(monitorValue) {
  if (!monitorValue) return -1;
  let wsIndex = monitorValue.indexOf("ws");
  let indexVal = monitorValue.slice(0, wsIndex);
  indexVal = indexVal.replace("mo", "");
  return parseInt(indexVal);
}

export function workspaceIndex(monitorValue) {
  if (!monitorValue) return -1;
  let wsIndex = monitorValue.indexOf("ws");
  if (wsIndex === -1) return -1;
  let indexVal = monitorValue.slice(wsIndex + 2); // +2 to skip "ws"
  let parsed = parseInt(indexVal);
  return isNaN(parsed) ? -1 : parsed;
}

export function createMonitorWorkspaceId(monitorIndex, workspaceIndex) {
  return `mo${monitorIndex}ws${workspaceIndex}`;
}

export function _disableDecorations() {
  let decos = global.window_group.get_children().filter((a) => a.type != null);
  decos.forEach((d) => {
    global.window_group.remove_child(d);
    d.destroy();
  });
}

export function dpi() {
  return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

export function isGnome(majorVersion) {
  return major == majorVersion;
}

export function isGnomeGTE(majorVersion) {
  return major >= majorVersion;
}

/**
 * Calculate drop regions for drag-and-drop tiling.
 * Given a target rectangle and a region width ratio, returns five regions:
 * left, right, top, bottom edges and center.
 *
 * @param {Object} targetRect - The target window's frame rectangle {x, y, width, height}
 * @param {number} regionWidth - Ratio of edge region width (0.0-0.5, e.g., 0.3 for 30%)
 * @returns {Object} Object with left, right, top, bottom, center region rectangles
 */
export function calculateDropRegions(targetRect, regionWidth) {
  return {
    left: {
      x: targetRect.x,
      y: targetRect.y,
      width: targetRect.width * regionWidth,
      height: targetRect.height,
    },
    right: {
      x: targetRect.x + targetRect.width * (1 - regionWidth),
      y: targetRect.y,
      width: targetRect.width * regionWidth,
      height: targetRect.height,
    },
    top: {
      x: targetRect.x,
      y: targetRect.y,
      width: targetRect.width,
      height: targetRect.height * regionWidth,
    },
    bottom: {
      x: targetRect.x,
      y: targetRect.y + targetRect.height * (1 - regionWidth),
      width: targetRect.width,
      height: targetRect.height * regionWidth,
    },
    center: {
      x: targetRect.x + targetRect.width * regionWidth,
      y: targetRect.y + targetRect.height * regionWidth,
      width: targetRect.width * (1 - regionWidth * 2),
      height: targetRect.height * (1 - regionWidth * 2),
    },
  };
}

/**
 * Check if a drop zone is horizontal (LEFT or RIGHT).
 * @param {string} zone - DROP_ZONES value
 * @returns {boolean}
 */
export function isHorizontalZone(zone) {
  return zone === DROP_ZONES.LEFT || zone === DROP_ZONES.RIGHT;
}

/**
 * Check if a drop zone is a "before" position (LEFT or TOP).
 * @param {string} zone - DROP_ZONES value
 * @returns {boolean}
 */
export function isBeforeZone(zone) {
  return zone === DROP_ZONES.LEFT || zone === DROP_ZONES.TOP;
}

/**
 * Detect which drop zone the pointer is in.
 * Priority: center first, then left/right before top/bottom.
 *
 * @param {Object} regions - Drop regions from calculateDropRegions()
 * @param {number[]} pointer - Pointer coordinates [x, y]
 * @returns {string} DROP_ZONES value (LEFT, RIGHT, TOP, BOTTOM, CENTER, or NONE)
 */
export function detectDropZone(regions, pointer) {
  // Center has highest priority
  if (rectContainsPoint(regions.center, pointer)) {
    return DROP_ZONES.CENTER;
  }
  // Left/right have priority over top/bottom
  if (rectContainsPoint(regions.left, pointer)) {
    return DROP_ZONES.LEFT;
  }
  if (rectContainsPoint(regions.right, pointer)) {
    return DROP_ZONES.RIGHT;
  }
  if (rectContainsPoint(regions.top, pointer)) {
    return DROP_ZONES.TOP;
  }
  if (rectContainsPoint(regions.bottom, pointer)) {
    return DROP_ZONES.BOTTOM;
  }
  return DROP_ZONES.NONE;
}
