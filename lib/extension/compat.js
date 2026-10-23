/*
 * This file is part of the Forge extension for GNOME
 *
 * Mutter API version-dispatch shims. All Meta.Window APIs that drifted
 * between supported Mutter releases are centralized here. Callers import
 * as `import * as Compat from "./compat.js"` and use Compat.<shim>(window).
 *
 * See docs/dev/compat.md for the per-release API drift map and the shim recipe
 * (memory forge-version-shim-recipe keeps the behavioral guardrails).
 */

import Meta from "gi://Meta";

import { SHELL_MAJOR } from "./shell-version.js";

export const IS_MUTTER_49_PLUS = SHELL_MAJOR >= 49;

export function isMaximized(metaWindow) {
  if (IS_MUTTER_49_PLUS) return metaWindow.is_maximized();
  return metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH;
}

export function isNotMaximized(metaWindow) {
  if (IS_MUTTER_49_PLUS) return !metaWindow.is_maximized();
  return metaWindow.get_maximized() === 0;
}

export function maximize(metaWindow, flags = Meta.MaximizeFlags.BOTH) {
  if (IS_MUTTER_49_PLUS) {
    metaWindow.set_maximize_flags(flags);
    metaWindow.maximize();
  } else {
    metaWindow.maximize(flags);
  }
}

export function unmaximize(metaWindow) {
  if (IS_MUTTER_49_PLUS) {
    metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
    metaWindow.unmaximize();
  } else {
    metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
  }
}

/**
 * The window's minimum size as a frame size ({ min_width, min_height }), or null
 * when it has none. Meta.Window has no get_size_hints(); get_min_size() reports
 * the client size, which CSD shadows and SSD title bars make smaller than the
 * frame Forge lays out (forge-ext/forge#117, #546).
 */
export function getMinFrameSize(metaWindow) {
  if (typeof metaWindow?.get_min_size !== "function") return null;
  try {
    const [hasMin, minWidth, minHeight] = metaWindow.get_min_size();
    if (!hasMin || (minWidth <= 0 && minHeight <= 0)) return null;
    // Frame extents (title bar, borders; negative for CSD shadows)
    const frame = metaWindow.get_frame_rect();
    const client = metaWindow.frame_rect_to_client_rect(frame);
    return {
      min_width: Math.max(0, minWidth + frame.width - client.width),
      min_height: Math.max(0, minHeight + frame.height - client.height),
    };
  } catch (e) {
    // the window may be going away mid-render
    return null;
  }
}

export function getMaximizeFlags(metaWindow) {
  if (IS_MUTTER_49_PLUS) return metaWindow.get_maximize_flags();
  return metaWindow.get_maximized();
}

/**
 * forge-16ms: is_on_all_workspaces() reports the EFFECTIVE sticky state, which
 * Mutter sets implicitly for every window on a non-primary monitor under the GNOME
 * default workspaces-only-on-primary=true — with no user intent.
 * is_always_on_all_workspaces() returns only the user-requested pin (the "Always on
 * Visible Workspace" toggle), which is what float-by-role actually wants. The method
 * has been in Mutter since well before GNOME 45; fall back to the effective state on
 * any build that lacks it.
 */
export function isAlwaysOnAllWorkspaces(metaWindow) {
  if (typeof metaWindow.is_always_on_all_workspaces === "function") {
    return metaWindow.is_always_on_all_workspaces();
  }
  return metaWindow.is_on_all_workspaces();
}
