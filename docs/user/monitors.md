# Multi-monitor

Each monitor has its own tree per workspace, split to suit its shape: landscape
monitors split horizontally, portrait ones vertically.

## Where new windows open

**New window placement** (`new-window-placement`, Preferences → Tiling):

- `pointer` (default): the monitor with the pointer or the active window.
- `window-actual`: the monitor the window opened on, which respects geometry an app
  restores.

If windows open on the wrong monitor, try the other one.

## Excluding monitors and workspaces

**Non-tiling monitors** (`monitor-skip-tile`) and **Non-tiling workspaces**
(`workspace-skip-tile`), in Preferences → Tiling, take comma-separated indices, e.g.
`0,1`. Windows there never tile, which suits a monitor kept for chat or media.
`Super+Shift+w` adds or removes the current workspace. When a workspace is removed
(with dynamic workspaces, GNOME removes one when it empties), the indices above it
shift down so each mark stays on its workspace, and the removed workspace's mark is
dropped. A workspace GNOME inserts between two others (for example by dropping a
window between them in the overview) does not shift the marks: an index then names
whichever workspace is at that position.

## Workspaces on the primary monitor only

With GNOME's default `workspaces-only-on-primary`, the other monitors' windows show on
every workspace. Forge carries those monitors' layouts to the active workspace, so
focus and moves across monitors work everywhere.

## Limitations

- Portrait monitors are not fully supported: focus and navigation across a portrait
  secondary monitor can misbehave. Excluding that monitor is the workaround.
- After a display change, if a layout looks wrong, disable and re-enable Forge to
  rebuild the tree.
