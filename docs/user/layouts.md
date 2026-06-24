# Layouts: how tiling works

Forge arranges each workspace's windows in a **tree** of containers, like i3/sway.
Every container arranges its children in one of a few **layouts**; you reshape the
tree with keyboard shortcuts (or drag-and-drop). Default chords are shown below —
press **`Super+Shift+/`** any time to open the in-app cheatsheet with your current
bindings, and see [keybindings.md](keybindings.md) to customize them.

## Splits (the default)

New windows tile side-by-side. A container is either a **horizontal split**
(windows left-to-right) or a **vertical split** (stacked top-to-bottom).

- **Toggle a container's split direction** — `Super+g`.
- Splits **nest**: split one pane vertically while its parent stays horizontal, and
  you get an L-shaped layout. This is how complex layouts are built.
- New windows inherit the focused container's split. Enable **Auto Split /
  Quarter Tiling** (`auto-split-enabled`, off by default) to alternate the split
  direction automatically based on the focused pane's shape.

## Stacked and tabbed

Instead of splitting space, a container can show one child at a time:

- **Stacked** (`Super+Shift+s`) — children listed vertically; the focused one
  expands (like a stack of title bars).
- **Tabbed** (`Super+Shift+t`) — children shown as a tab strip; toggle the tab
  decoration with the tab-decoration shortcut.
- Both modes are **on by default** (`stacked-tiling-mode-enabled` /
  `tabbed-tiling-mode-enabled`, in Preferences → Tiling → Behavior). Turn a mode off
  and its toggle shortcut does nothing.
- `auto-exit-tabbed` (on by default) drops a container back to a split when only one
  tab remains.
- `default-window-layout` (`tiled` | `tabbed` | `stacked`) sets the layout a newly
  *split* container starts in.

## Monocle

Monocle gathers **all** of the workspace's tiled windows into a single **tabbed**
container — you see one window at a time and switch with the tab strip, a focus mode
for a busy workspace. Toggle again to return to your previous split layout. Bind it
yourself: **`workspace-monocle-toggle` has no default chord** (set one in
Preferences → Keyboard).

## Snap / quarter presets

Snap the focused window to a region without restructuring the tree (defaults use
`Ctrl+Alt`):

- Halves/thirds: snap 1/3 and 2/3 left/right (e.g. `Ctrl+Alt+d` = 1/3 left).
- **Center** — `Ctrl+Alt+c`.

## Float vs tile

Any window can be pulled out of the tree to **float**, or floated for its whole app
class, via the [float toggles](keybindings.md#common-defaults). Some apps float
automatically; you control this per-app with [window rules](rules.md). A floating
window keeps its place in the tree and re-tiles when you toggle it back.

## Drag to tile

Drag a window over another and Forge shows a **preview hint** (left / right / top /
bottom / center) of where it will land; drop to tile it there. A center drop creates
a tabbed or stacked container (`dnd-center-layout`, default `tabbed`). Whether you
must hold a modifier while dragging is set by the drag mask — see
[keybindings.md](keybindings.md#drag-to-tile).
