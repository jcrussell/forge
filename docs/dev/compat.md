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
that branches `if (IS_MUTTER_49_PLUS) { … } else { … }`. Version dispatch (not
`try/catch`) is deliberate: it reads clearly, costs no exception on the hot path,
and self-documents which API landed where.

## Current shims (`compat.js`)

| Shim | Mutter ≤ 48 | Mutter ≥ 49 |
| --- | --- | --- |
| `isMaximized` / `isNotMaximized` | `get_maximized() === BOTH` / `=== 0` | `is_maximized()` |
| `maximize(w, flags)` | `maximize(flags)` | `set_maximize_flags(flags)` + `maximize()` |
| `unmaximize(w)` | `unmaximize(BOTH)` | `set_unmaximize_flags(BOTH)` + `unmaximize()` |
| `getMaximizeFlags` | `get_maximized()` | `get_maximize_flags()` |

## Drift map (reference)

`meta_window_*` across the tags Forge supports:

- `maximize` / `unmaximize`: **48** `(window, flags)` → **49+** `(window)` no-arg
  (flags now set separately via `set_maximize_flags` / `set_unmaximize_flags`).
- `get_maximized` (returns `MetaMaximizeFlags`): **removed at 49**; replaced by
  `is_maximized()` (gboolean) and `get_maximize_flags()`.
- `set_unmaximize_flags` (**49+**) **early-returns** unless the window was actually
  maximized — so on a tile-mode-but-not-maximized window it does **not** clear
  `tile_mode`.
- `meta_window_untile` is `META_EXPORT_TEST` (private, not callable from GJS) across
  48/49/50 — the API gap that forces Forge's 1px-shave geometry workaround for the
  Wayland tile-inference bug.
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

> The behavioral guardrails here (the try-new-shape recipe and the
> `set_unmaximize_flags` early-return trap) are also kept as `bd` memories so they
> surface in agent context, not just on a docs read.
