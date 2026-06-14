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

Some actions ship **unbound** (e.g. workspace monocle) — assign them yourself.
Forge intentionally frees several GNOME defaults on enable (native edge-tiling,
maximize/unmaximize keys, `Super+L`) so they don't collide; these are restored when
the extension is disabled.

## Customizing

Three equivalent ways to change a binding:

- **Preferences → Keyboard** — click a shortcut row, press the new chord (Enter to
  apply, clear the field to unbind). The easiest path.
- **GSettings** — schema `org.gnome.shell.extensions.forge.keybindings`, each key an
  array of accelerator strings (e.g. `['<Super>h', '<Super>Left']`).
- **Portable file** — `~/.config/forge/config/keybindings.json` (see
  [config.md](config.md)); reload with `Super+Shift+r`.

## Drag to tile

Dragging a window can tile it (see [layouts.md](layouts.md#drag-to-tile)). The
**`mod-mask-mouse-tile`** setting picks the modifier you hold while dragging for the
tile preview to appear: `None` (default — any drag tiles), or `Super` / `Ctrl` /
`Alt` (only tile while that modifier is held). `preview-hint-enabled` controls
whether the drop-zone hint is drawn.
