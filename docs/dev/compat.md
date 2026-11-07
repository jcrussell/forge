# Mutter API compatibility

Forge supports GNOME Shell 45+. Several `Meta.Window` APIs changed signature across
releases (most at Mutter 49). **All version drift is centralized in
`lib/extension/compat.js`** as small dispatch shims; callers do
`import * as Compat from "./compat.js"` and use `Compat.<shim>(window)`.

## The pattern

```js
const SHELL_MAJOR = parseInt(PACKAGE_VERSION.split(".")[0], 10);   // shell-version.js
export const IS_MUTTER_49_PLUS = SHELL_MAJOR >= 49;                // compat.js (imports SHELL_MAJOR)
```

GNOME Shell and Mutter share a version (same release cycle), so the Shell major
version is a reliable Mutter-capability gate. Each shim is a plain exported function
that branches on an `IS_MUTTER_NN_PLUS` constant. Version dispatch (not
`try/catch`) is deliberate: it reads clearly, costs no exception on the hot path,
and self-documents which API landed where.

`compat.js` holds one shim per drifted API; read it for the current set. GNOME 48
and 51 also changed St and Clutter (`vertical` → `orientation`, the Clutter backend
getter); those shims live there too.

## Drift map (reference)

`meta_window_*` across the tags Forge supports:

- `maximize` / `unmaximize`: **48** `(window, flags)` → **49+** `(window)` no-arg
  (flags now set separately via `set_maximize_flags` / `set_unmaximize_flags`).
- `get_maximized` (returns `MetaMaximizeFlags`): **removed at 49**; replaced by
  `is_maximized()` (gboolean) and `get_maximize_flags()`.
- `set_unmaximize_flags` (**49+**) **early-returns** unless the window was actually
  maximized — so on a tile-mode-but-not-maximized window it does **not** clear
  `tile_mode`.
- **49+**: `set_maximize_flags(flags)` / `set_unmaximize_flags(flags)` *perform* the
  (un)maximize; `maximize()` / `unmaximize()` are just the BOTH variants (`maximize()`
  also refuses `unmanaging` windows). They are not "stage, then apply" pairs.
- **51**: `set_unmaximize_flags` / `unmaximize` on a **non-maximized** window no longer
  early-returns — `meta_window_process_config()` falls through to
  `meta_window_move_resize()`. Doing that on every render crashed gnome-shell 51 in
  `meta_window_update_monitor(NULL)`, hence `Compat.unmaximize` checks the flags first.
- `meta_window_untile` is `META_EXPORT_TEST` (private, not callable from GJS) across
  48/49/50 — the API gap that forces Forge's 1px-shave geometry workaround for the
  Wayland tile-inference bug.
- `get_min_size` / `get_max_size`: **added at 50** (mutter 881a00d25f). Before that
  no `meta_window_*` API exposes a window's size hints, so minimum-size-aware tiling
  (`Tree._minSizeInOrientation`) is off on 45–49. There never was a
  `get_size_hints()`; the e2e `test_real_window_reports_min_size` asserts both on
  every lane, and the min-size layout test skips before 50. The hints are a **client** size (Wayland adds the CSD
  `custom_frame_extents`, `meta-window-wayland.c`), and Mutter's own constraints
  convert them with `client_rect_to_frame_rect`; `getMinFrameSize` does the same.
- `begin_grab_op` signature changed at 49, but Forge doesn't call it from GJS — no
  impact.

## Adding a new shim

1. Add an exported function to `compat.js` with version dispatch.
2. If it's a new cutoff, add an `IS_MUTTER_NN_PLUS` constant.
3. Replace every callsite with the shim.
4. **Acceptance:** `grep -nE "metaWindow\.<changed-api>" lib/extension/ extension.js`
   should match **only** inside `compat.js`.

For the rare downstream-distro backport where version ≠ capability, switch that one
shim's dispatch from the version constant to a feature check
(`typeof w.method === "function"`) — same module, same callsites.
