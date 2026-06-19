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

- **`enable()`** (`extension.js`): loads the two GSettings schemas (main +
  `…forge.keybindings`); saves and overrides conflicting GNOME settings
  (`SETTINGS_OVERRIDES`, `extension.js` — e.g. Mutter `edge-tiling`,
  `auto-maximize`, native maximize/tile keybindings; each original is restored on
  disable); then constructs, in order: `ConfigManager` → `ConfigSync` → theme →
  `WindowManager` → `Keybindings` → `Cheatsheet`; finally `extWm.enable()`.
- **`disable()`** (`extension.js`): restores the saved GNOME settings, then
  tears down each subsystem and nulls every reference. Order mirrors construction.
- **Session modes** (`_onSessionModeChanged`, `extension.js`): on the lock
  screen Forge **keeps the tree in memory** but disables keybindings and removes
  the indicator; it re-enables them on return to the `user` session. The tree is
  never serialized — locking must not lose the layout.

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
| `command.js` `CommandHandler` | Turns a user action into tree mutations (extracted from window.js). |
| `keybindings.js` `Keybindings` | Registers shell keybindings → `CommandHandler`; drag modifier mask. |
| `workspace.js` `WorkspaceManager` | Workspace nodes + per-workspace signal lifecycle + renumbering. |
| `monitor.js` `MonitorManager` | Monitor-per-workspace nodes; split orientation per monitor geometry. |
| `cheatsheet.js` `Cheatsheet` | In-shell keybinding overlay (`Super+Shift+/`). |
| `indicator.js` | Quick-settings panel toggle. |
| `lib/shared/settings.js` `ConfigManager` | GSettings + JSON config (`windows.json` overrides). |
| `lib/shared/config-sync.js` `ConfigSync` | Mirrors GSettings ⇄ `settings.json`/`keybindings.json`. |
| `lib/shared/theme.js` + `lib/css/` | Stylesheet parsing/customization (see rendering.md). |

User-facing strings are localized with gettext; the catalog (`po/`) and Weblate
workflow are documented in [translations.md](translations.md).

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

Every subsystem **tracks its signal IDs and disconnects them on teardown** —
GNOME Shell reloads extensions in-process, so a leaked signal survives and
crashes later.

- `WindowManager._bindSignals()` / `_removeSignals()` (`window.js`)
  connect/disconnect display, workspace-manager, and per-window signals; the
  defensive disconnect ignores throws on already-finalized GObjects (Bug #328).
- Managers own their own signals: `WorkspaceManager._workspaceSignals` is a
  `Map<wsIndex, signalIds>` unbound in `removeWorkspace`/`destroy`
  (`workspace.js`).
- **Idle/timeout source IDs are reset in a `finally`** so a single throw can't
  wedge them. If `_renderTreeSrcId` stuck non-zero, every later `renderTree()`
  would no-op and new windows would stay floating (Bug #531 / forge-cuv; see
  rendering.md). The `window-added` debounce uses the same pattern
  (`workspace.js`).

## Configuration sources

Two layers, reconciled by `ConfigManager` + `ConfigSync`:

- **GSettings** — schema `org.gnome.shell.extensions.forge` (+ `.keybindings`).
  The runtime source of truth.
- **JSON files** under `~/.config/forge/config/`:
  - `windows.json` — per-window / per-class float & tile overrides
    (`ConfigManager`, `lib/shared/settings.js`).
  - `settings.json` / `keybindings.json` — portable mirror of GSettings, written
    and re-imported by `ConfigSync` (`config-sync.js`; see its `SETTINGS_KEYS` and
    `KEYBINDING_KEYS` maps) so a config can be version-controlled or moved between
    machines.

`ConfigSync.init()` runs during `enable()` and imports any present files.
