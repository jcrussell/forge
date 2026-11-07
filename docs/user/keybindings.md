# Keybindings

**`Super+Shift+/`** toggles a cheatsheet of every bound shortcut, read live from
your settings. It is the authoritative list; the tables below are the common
defaults and the actions it can't show.

## Common defaults

Focus also accepts the arrow keys.

| Action | Default |
| --- | --- |
| Focus left / down / up / right | `Super+h` / `j` / `k` / `l` |
| Swap in a direction | `Ctrl+Super+h/j/k/l` |
| Move in a direction | `Super+Shift+h/j/k/l` |
| Float this window / this app | `Super+c` / `Super+Shift+c` |
| Toggle split direction | `Super+g` |
| Split vertically / horizontally | `Super+v` / `Super+z` |
| Stacked / tabbed layout | `Super+Shift+s` / `Super+Shift+t` |
| Swap with the last active window | `Super+Return` |
| Equal sizes | `Super+=` |
| Snap 1/3 left / center | `Ctrl+Alt+d` / `Ctrl+Alt+c` |
| Toggle tiling / tiling on this workspace | `Super+w` / `Super+Shift+w` |
| Preferences | `Super+.` |
| Reload config files | `Super+Shift+r` |
| Lock screen | `Super+q` |

## Unbound by default

The cheatsheet lists only bound actions, so these are easy to miss. Bind them in
Preferences → Keyboard.

| Action | Setting |
| --- | --- |
| Focus / swap with next or previous sibling, wrapping | `window-focus-next`, `window-focus-prev`, `window-swap-next`, `window-swap-prev` |
| [Golden-ratio resize](layouts.md#golden-ratio) | `window-golden-ratio` |
| [Monocle](layouts.md#monocle) | `workspace-monocle-toggle` |
| Move the pointer to the focused window | `window-pointer-to-focus` |
| Export config files | `prefs-config-export` |

Next/previous walks the focused window's tiled siblings, which is the
unambiguous way to cycle a stacked or tabbed container.

## GNOME shortcuts Forge takes over

While enabled, Forge clears GNOME settings that collide with its own: edge tiling,
auto-maximize, the half-tile, maximize, unmaximize and minimize keys, the
notification-list keys (`Super+v`, `Super+m`) and `Super+l` lock (use `Super+q`). The originals
are saved first and restored on disable, even after a crash.

To keep GNOME's edge tiling, turn off **Disable GNOME edge-tiling** in Preferences →
Tiling. Turning Forge tiling off (`Super+w`) also restores it.

Forge leaves workspace switching to GNOME; bind those shortcuts in GNOME Settings.

## Customizing

- **Preferences → Keyboard:** click a row, press the chord, Enter. Clear the field
  to unbind. A chord already used by another Forge action is flagged, not blocked.
- **GSettings:** schema `org.gnome.shell.extensions.forge.keybindings`; each key is a
  list of accelerators, e.g. `['<Super>h', '<Super>Left']`.
- **[`keybindings.json`](config.md)**.
