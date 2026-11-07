# Layouts

Forge keeps each workspace's windows in a tree of containers, as i3 and sway do.
Each container lays out its children in one layout. Shortcuts below are defaults;
see [keybindings](keybindings.md).

## Splits

A container is a horizontal split (left to right) or a vertical split (top to
bottom). New windows join the focused container.

- `Super+g` flips the focused container's direction.
- `Super+v` / `Super+z` split the focused window vertically / horizontally. Splits
  nest, which is how complex layouts are built.
- **Quarter tiling** (`auto-split-enabled`, off) picks the direction from the
  focused window's shape instead. A direction chosen with `Super+v` / `Super+z`
  still wins.
- **Auto re-orient on close** (`auto-reorient-on-close`, off) flips a split to match
  its shape when a child closes. It overrides directions you set by hand.

## Stacked and tabbed

The container shows one child at a time, with a title bar per child: stacked
(`Super+Shift+s`) lists them vertically, tabbed (`Super+Shift+t`) as a tab strip.

- Each mode can be turned off in Preferences → Tiling; its shortcut then does
  nothing.
- **Auto exit tabbed tiling** (on) returns a container to a split when one tab is left.
- **Default layout for new windows** (`default-window-layout`) sets the layout of a
  container a split creates.
- Tab bar position and height are in Preferences → Appearance. `Ctrl+Alt+y` hides
  the bars; switch children with focus navigation.

## Monocle

Gathers the tiled windows on the workspace's first monitor into one tabbed
container; toggling again leaves them in one flat split. Unbound by default
(`workspace-monocle-toggle`).

## Snapping

`Ctrl+Alt` chords float the focused window and place it on a third, two thirds or
the center of the screen. `Super+c` tiles it again.

## Golden ratio

Resizes the focused window against its neighbour at about 1.618:1, keeping the tree
as is. `Super+=` evens them out again. Unbound by default (`window-golden-ratio`).

## Floating

`Super+c` floats the focused window, `Super+Shift+c` its whole app. A floating
window keeps its place in the tree and returns there when tiled again. Some windows
float automatically; [window rules](rules.md) control which.

## Drag to tile

Drag a window over another and a preview shows where it will land (left, right, top,
bottom or center); drop to tile it there. A center drop makes a tabbed or stacked
container (**Drag-and-drop behavior**, `dnd-center-layout`).

**Drag-and-drop modifier key** (Preferences → Keyboard, `mod-mask-mouse-tile`)
makes tiling happen only while that key is held. The default, `None`, tiles every
drag. `preview-hint-enabled` turns the preview off.
