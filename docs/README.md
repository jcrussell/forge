# Forge documentation

Reference docs for [Forge](../README.md), an i3/sway-style tiling window manager
for GNOME Shell. Start with the top-level [README](../README.md) (install,
features) and [CLAUDE.md](../CLAUDE.md) (build commands, repo conventions); these
pages go deeper.

> These pages reference code by file and symbol name (e.g. `renderTree()` in
> `window.js`) rather than line numbers, so `grep`/your editor's symbol search is
> the fastest way to jump to one.

## Developer reference (`docs/dev/`)

- **[architecture.md](dev/architecture.md)** — how the pieces fit: the extension
  lifecycle, the tiling-tree data model, the subsystems, command dispatch, the
  GObject signal/cleanup discipline, and configuration sources.
- **[rendering.md](dev/rendering.md)** — the render/placement pipeline
  (`renderTree → processFloats → tree.render → apply → move`), tree-reload
  triggers, the floating subsystem, and the CSS/theme engine.
- **[compat.md](dev/compat.md)** — the Mutter API version-drift map and the
  `compat.js` shim recipe (GNOME 45+ support).
- **[hazards.md](dev/hazards.md)** — the bug-class → guardrail catalog and the
  custom ESLint rules that enforce it.
- **[translations.md](dev/translations.md)** — the gettext/i18n setup for the
  extension and prefs.

## User guide (`docs/user/`)

- **[layouts.md](user/layouts.md)** — how tiling works: splits, stacked, tabbed,
  monocle, snap presets, float vs tile, drag-to-tile.
- **[keybindings.md](user/keybindings.md)** — the in-app cheatsheet, common
  defaults, customizing, the drag modifier mask.
- **[theming.md](user/theming.md)** — appearance settings, gaps, and custom CSS.
- **[rules.md](user/rules.md)** — per-window/per-class float & tile overrides.
- **[config.md](user/config.md)** — portable config: backup, sync, move between machines.
- **[monitors.md](user/monitors.md)** — multi-monitor placement and limitations.
- **[troubleshooting.md](user/troubleshooting.md)** — reloading, debug logs, common issues.

Contributing? See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Testing

Test docs live next to the code they describe:

- [`tests/README.md`](../tests/README.md) — unit tests (Vitest + mocked GNOME APIs).
- [`tests/e2e/README.md`](../tests/e2e/README.md) — end-to-end tests (real GNOME
  Shell in Docker).
