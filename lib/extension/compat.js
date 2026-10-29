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
export const IS_MUTTER_50_PLUS = SHELL_MAJOR >= 50;
export const IS_MUTTER_51_PLUS = SHELL_MAJOR >= 51;

export function isMaximized(metaWindow) {
  if (IS_MUTTER_49_PLUS) return metaWindow.is_maximized();
  return metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH;
}

export function isNotMaximized(metaWindow) {
  if (IS_MUTTER_49_PLUS) return !metaWindow.is_maximized();
  return metaWindow.get_maximized() === 0;
}

/**
 * Mutter 49+ (window.c of 49.0/50.5/51.0): set_maximize_flags(flags) performs the
 * maximize itself and maximize() is set_maximize_flags(BOTH) plus an unmanaging
 * guard, so exactly one of them is called — never both, which would turn a
 * partial maximize into BOTH.
 */
export function maximize(metaWindow, flags = Meta.MaximizeFlags.BOTH) {
  if (!IS_MUTTER_49_PLUS) {
    metaWindow.maximize(flags);
  } else if (flags === Meta.MaximizeFlags.BOTH) {
    metaWindow.maximize();
  } else {
    metaWindow.set_maximize_flags(flags);
  }
}

/**
 * Only unmaximize a window that is maximized on some axis. On Mutter 51 an
 * unmaximize request on a non-maximized window is no longer a no-op:
 * meta_window_process_config() falls through to meta_window_move_resize(),
 * which crashed gnome-shell in meta_window_update_monitor(NULL) when Forge did
 * it on every render. Earlier releases early-returned in that case, so the
 * guard does not change behavior there.
 */
export function unmaximize(metaWindow) {
  if (getMaximizeFlags(metaWindow) === 0) return;
  if (IS_MUTTER_49_PLUS) {
    metaWindow.unmaximize();
  } else {
    metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
  }
}

/**
 * The window's minimum size as a frame size ({ min_width, min_height }), or null
 * when it has none. Mutter exposes a window's minimum only from 50, through
 * get_min_size(), as a client size, which CSD shadows and SSD title bars make
 * differ from the frame Forge lays out (forge-ext/forge#117, #546). Before 50
 * no API exposes it (there never was a get_size_hints()), so minimum-size-aware
 * tiling is off there (compat.md).
 */
export function getMinFrameSize(metaWindow) {
  if (!IS_MUTTER_50_PLUS || !metaWindow) return null;
  const [hasMin, minWidth, minHeight] = metaWindow.get_min_size();
  if (!hasMin || (minWidth <= 0 && minHeight <= 0)) return null;
  // Frame extents (title bar, borders; negative for CSD shadows)
  const frame = metaWindow.get_frame_rect();
  const client = metaWindow.frame_rect_to_client_rect(frame);
  return {
    min_width: Math.max(0, minWidth + frame.width - client.width),
    min_height: Math.max(0, minHeight + frame.height - client.height),
  };
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
