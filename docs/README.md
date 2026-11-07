# Forge documentation

## User guide

- [Layouts](user/layouts.md): splits, stacked, tabbed, monocle, snapping, floating, drag-to-tile.
- [Keybindings](user/keybindings.md): defaults, unbound actions, the GNOME shortcuts Forge takes over, customizing.
- [Window rules](user/rules.md): which windows float or tile.
- [Theming](user/theming.md): appearance settings, gaps, custom CSS.
- [Portable config](user/config.md): settings and keybindings as JSON files.
- [Multi-monitor](user/monitors.md): placement, excluding monitors, limitations.
- [Troubleshooting](user/troubleshooting.md): restarting, debug logs, known limitations, reporting bugs.

## Developer reference

Start with [CONTRIBUTING.md](../CONTRIBUTING.md). These pages name code by file and
symbol, not line number; use your editor's symbol search.

- [Architecture](dev/architecture.md): lifecycle, the tiling tree, command dispatch, signal cleanup, config sources.
- [Rendering](dev/rendering.md): the render pipeline, tree reloads, floating, the theme engine.
- [Compat](dev/compat.md): Mutter API drift across GNOME versions and how to shim it.
- [Hazards](dev/hazards.md): recurring bug classes and the guardrails against them.
- [Translations](dev/translations.md): gettext workflow.
- [Unit tests](../tests/README.md) and [e2e tests](../tests/e2e/README.md).
- [Releasing](../RELEASING.md).
