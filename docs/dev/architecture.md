# Architecture

Forge organizes a workspace's windows as a **tree** (like i3/sway) and reconciles
that tree onto the screen. Three tiers:

1. **Tree data model** (`lib/extension/tree.js`) — the in-memory layout.
2. **Window manager** (`lib/extension/window.js`) — the event hub that reacts to
   GNOME signals, mutates the tree, and renders it.
3. **GNOME integration** — keybindings, quick-settings indicator, preferences,
   theming, and the Mutter-version shims.

See [rendering.md](rendering.md) for the render pipeline and [compat.md](compat.md)
for Mutter API drift.

## Entry point & lifecycle

`extension.js` is the `ForgeExtension` (a GNOME `Extension` subclass).

- **`enable()`**: loads both GSettings schemas and applies the GNOME overrides in
  `SETTINGS_OVERRIDES` (`lib/shared/gnome-overrides.js`). The originals go into the
  `gnome-overrides-snapshot` key first, so an exit that skips `disable()` can't lose
  them; the next `enable()` reuses the snapshot. Then it constructs `ConfigManager`
  → `ConfigSync` → theme → `WindowManager` → `Keybindings` → `Cheatsheet`, and calls
  `extWm.enable()`.
- **`disable()`**: restores the GNOME settings, clears the snapshot once all of them
  are back, then tears down
  the subsystems and nulls every reference.
- **Session modes** (`_onSessionModeChanged`): on the lock screen Forge keeps the
  tree in memory but drops keybindings and the indicator, and restores them in the
  `user` session. The tree is never serialized, so locking must not lose it.

## The tiling tree

Defined in `tree.js`. Node types (`NODE_TYPES`, `tree.js`):

```
ROOT ─ WORKSPACE ─ MONITOR ─┬─ WINDOW
                            └─ CON ─┬─ WINDOW
                                    └─ CON ─ …      (containers nest)
```

- **`Node`** (`tree.js`) — one monitor, workspace, container (`CON`), or window.
- **`Tree`** (`tree.js`) `extends Node`; its constructor calls
  `super(NODE_TYPES.ROOT, …)` (`tree.js`), so **the `Tree` instance *is* the
  root node** — there is no `tree.root` property. Walk from `tree` itself.
- **Layouts** (`LAYOUT_TYPES`, `tree.js`): `HSPLIT`, `VSPLIT`, `STACKED`,
  `TABBED`, `PRESET` (+ `ROOT`). A container's layout decides how its children are
  arranged.
- **Window modes** (`WINDOW_MODES` in `tree.js`): `TILE`, `FLOAT`, `GRAB_TILE`
  (being dragged), `DEFAULT`. Float state is the node's `mode`, **not** tree
  membership — a floating window keeps its node.

## Subsystems

| Module | Responsibility |
| --- | --- |
| `window.js` `WindowManager` | Event hub: binds GNOME signals, tracks windows, owns `renderTree`/`move`, focus, grab/drag. |
| `command.js` `CommandHandler` | Turns a user action into tree mutations. |
| `focus.js` `FocusManager` | Focus tracking and the active-window signal lifecycle. |
| `decoration.js` `DecorationManager` | Stacked/tabbed decorations and their actors. |
| `keybindings.js` `Keybindings` | Registers shell keybindings → `CommandHandler`; drag modifier mask. |
| `workspace.js` `WorkspaceManager` | Workspace nodes + per-workspace signal lifecycle + renumbering. |
| `monitor.js` `MonitorManager` | Monitor-per-workspace nodes; split orientation per monitor geometry. |
| `cheatsheet.js` `Cheatsheet` | In-shell keybinding overlay (`Super+Shift+/`). |
| `indicator.js` | Quick-settings panel toggle. |
| `lib/shared/settings.js` `ConfigManager` | GSettings + JSON config (`windows.json` overrides). |
| `lib/shared/config-sync.js` `ConfigSync` | Mirrors GSettings ⇄ `settings.json`/`keybindings.json`. |
| `lib/shared/theme.js` + `lib/css/` | Stylesheet parsing/customization (see rendering.md). |

## Command dispatch flow

```
key chord ─▶ Main.wm.addKeybinding (keybindings.js) ─▶ callback
          ─▶ CommandHandler.execute(action) (command.js, switch on action.name)
          ─▶ WindowManager / Tree mutation ─▶ wm.renderTree(...)
```

`Keybindings.enable()` (`keybindings.js`) registers every entry of `this._bindings`;
each callback dispatches an `action` object into the `execute` switch. Drag-to-tile
is gated by the modifier mask in `allowDragDropTile()` (`keybindings.js`).

## GObject lifecycle discipline

Core classes are GObjects registered with `static { GObject.registerClass(this); }`.
Every subsystem **tracks its signal IDs and disconnects them on teardown**: GNOME
Shell reloads extensions in-process, so a leaked handler outlives `disable()` and
crashes later.

- `WindowManager._bindSignals()` / `_removeSignals()` own the display,
  workspace-manager and per-window signals. The disconnect tolerates
  already-finalized objects.
- Managers own their signals, e.g. `WorkspaceManager._workspaceSignals`, unbound in
  `removeWorkspace`/`destroy`.
- Idle and timeout source IDs are cleared in a `finally`, so one throw can't wedge
  them ([rendering.md](rendering.md#rendertreefrom-force--windowjs)).

[hazards.md](hazards.md) lists the guardrails that enforce this.

## Configuration sources

Two layers, reconciled by `ConfigManager` + `ConfigSync`:

- **GSettings** (`org.gnome.shell.extensions.forge` and `.keybindings`): the runtime
  source of truth.
- **`windows.json`**: window rules, owned by `ConfigManager` (`lib/shared/settings.js`).
- **`settings.json` / `keybindings.json`**: a portable mirror of GSettings, owned by
  `ConfigSync` (`config-sync.js`; its `SETTINGS_KEYS` and `KEYBINDING_KEYS` say what
  syncs). User-facing behavior: [config.md](../user/config.md).
