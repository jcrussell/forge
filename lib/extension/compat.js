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

import Clutter from "gi://Clutter";
import Meta from "gi://Meta";

import { SHELL_MAJOR } from "./shell-version.js";

export const IS_MUTTER_48_PLUS = SHELL_MAJOR >= 48;
export const IS_MUTTER_49_PLUS = SHELL_MAJOR >= 49;
export const IS_MUTTER_51_PLUS = SHELL_MAJOR >= 51;

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

/**
 * St widget orientation construct props. GNOME 48 added `orientation` and
 * deprecated the boolean `vertical`; GNOME 51 removed `vertical`, so passing it
 * there throws "No property vertical on StBoxLayout". Spread into the params:
 * `new St.BoxLayout({ ...Compat.stBoxOrientation(true), ... })`.
 */
export function stBoxOrientation(vertical) {
  if (IS_MUTTER_48_PLUS) {
    return {
      orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
    };
  }
  return { vertical };
}

/**
 * The Clutter backend (for the default seat, pointer warping, ...). GNOME 51
 * removed Clutter.get_default_backend() in favor of the stage's context.
 */
export function getClutterBackend() {
  if (IS_MUTTER_51_PLUS) {
    // The bundled @girs typings predate ClutterStage:context (Mutter 47+).
    const stage = /** @type {{ context: { get_backend(): Clutter.Backend } }} */ (
      /** @type {unknown} */ (global.stage)
    );
    return stage.context.get_backend();
  }
  return Clutter.get_default_backend();
}
