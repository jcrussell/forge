# Keybindings

## The built-in cheatsheet

Forge ships a live, always-current shortcut reference. Press **`Super+Shift+/`**
(shown as `Super + ?`) to toggle an on-screen overlay that lists **your** current
bindings, grouped by category. It's generated from settings at runtime, so it never
drifts from what's actually bound — treat it as the source of truth rather than any
static list.

## Common defaults

A vim-style orientation (full list is in the cheatsheet). Most navigation chords
also accept arrow keys.

| Action | Default |
| --- | --- |
| Focus left / down / up / right | `Super+h` / `j` / `k` / `l` (or arrows) |
| Swap window in a direction | `Ctrl+Super+h/j/k/l` |
| Move window in a direction | `Super+Shift+h/j/k/l` |
| Toggle float (this window) | `Super+c` |
| Toggle float (whole app class) | `Super+Shift+c` |
| Toggle split direction | `Super+g` |
| Stacked layout | `Super+Shift+s` |
| Tabbed layout | `Super+Shift+t` |
| Snap center | `Ctrl+Alt+c` |
| Open preferences | `Super+Period` |
| Reload config from disk | `Super+Shift+r` |
| Toggle cheatsheet | `Super+Shift+/` |
| Lock screen | `Super+q` |

### Ships unbound

These have **no default chord** — the cheatsheet only lists bound actions, so
assign them in Preferences → Keyboard to discover them:

| Action | Setting |
| --- | --- |
| Focus next / previous sibling (cyclic) | `window-focus-next` / `window-focus-prev` |
| Swap with next / previous sibling (cyclic) | `window-swap-next` / `window-swap-prev` |
| [Golden ratio resize](layouts.md#golden-ratio) | `window-golden-ratio` |
| [Toggle monocle](layouts.md#monocle) | `workspace-monocle-toggle` |
| Move pointer to focused window | `window-pointer-to-focus` |
| Export configuration | `prefs-config-export` |

The cyclic actions walk the focused window's **tiled siblings** in order and wrap
around at the ends, so you can cycle a container without thinking about direction —
useful inside a stacked or tabbed container where up/down navigation is ambiguous.

### GNOME defaults Forge frees

Forge intentionally frees several GNOME defaults on enable (native edge-tiling,
maximize/unmaximize/minimize keys, `Super+L`) so they don't collide; **all are
restored when the extension is disabled**.

Edge-tiling is opt-out: **Disable GNOME edge-tiling** (`disable-edge-tiling`, on by
default, in Preferences → Tiling) controls it. Turn it off to keep GNOME's native
half-tiling alongside Forge. It's also tied to Forge's own tiling toggle — switching
Forge tiling off (`Super+w`) restores GNOME edge-tiling immediately, and switching
it back on re-applies the override.

## Customizing

Three equivalent ways to change a binding:

- **Preferences → Keyboard** — click a shortcut row, press the new chord (Enter to
  apply, clear the field to unbind). The easiest path.
- **GSettings** — schema `org.gnome.shell.extensions.forge.keybindings`, each key an
  array of accelerator strings (e.g. `['<Super>h', '<Super>Left']`).
- **Portable file** — `~/.config/forge/config/keybindings.json` (see
  [config.md](config.md)); reload with `Super+Shift+r`.

If you assign a chord that's already taken by another Forge action, Preferences →
Keyboard warns you and names the actions it collides with. The binding is still
applied — Forge doesn't block it — so you can resolve the conflict whichever way
you prefer.

## Drag to tile

Dragging a window can tile it (see [layouts.md](layouts.md#drag-to-tile)). The
**`mod-mask-mouse-tile`** setting picks the modifier you hold while dragging for the
tile preview to appear: `None` (default — any drag tiles), or `Super` / `Ctrl` /
`Alt` (only tile while that modifier is held). `preview-hint-enabled` controls
whether the drop-zone hint is drawn.
