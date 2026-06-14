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
import { PACKAGE_VERSION } from "resource:///org/gnome/shell/misc/config.js";

const SHELL_MAJOR = parseInt(PACKAGE_VERSION.split(".")[0], 10);
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

export function getMaximizeFlags(metaWindow) {
  if (IS_MUTTER_49_PLUS) return metaWindow.get_maximize_flags();
  return metaWindow.get_maximized();
}
