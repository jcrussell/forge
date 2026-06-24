# Forge (maintained by Claude)

[![CI](https://github.com/jcrussell/forge/actions/workflows/testing.yml/badge.svg)](https://github.com/jcrussell/forge/actions/workflows/testing.yml)
[![codecov](https://codecov.io/github/jcrussell/forge/graph/badge.svg?token=MFNOBH5D4L)](https://codecov.io/github/jcrussell/forge)

An AI-maintained fork of [Forge](https://github.com/forge-ext/forge), the GNOME
Shell extension that provides i3/sway-style tiling window management.

This fork addresses bugs and adds features while the upstream project seeks a
new maintainer. Contributions here are intended to be upstreamed when possible.
Thanks to [@jmmaranan](https://github.com/jmmaranan) and all original
contributors for creating this excellent extension.

## Features

- Works on GNOME 45+ (X11 and Wayland)
- Tree-based tiling with vertical and horizontal split containers similar to i3-wm and sway-wm
- Vim-like keybindings for navigation/swapping windows/moving windows in the containers
- Drag and drop tiling
- Support for floating windows, smart gaps and focus hint
- Customizable shortcuts in extension preferences
- Some support for multi-display
- Tiling support per workspace
- Update hint color scheme from preferences
- Stacked and tabbed tiling layouts, plus workspace monocle
- Swap current window with the last active window
- Auto Split or Quarter Tiling
- Show/hide tab decoration via keybinding
- Window resize using keyboard shortcuts

## Fork Improvements

This fork includes significant improvements over the upstream version:

### New Features

- **Keybindings cheatsheet overlay** - Quick reference for all shortcuts (`Super+Shift+/`)
- **Portable config sync** - Export/import settings and keybindings for backup or sharing
- **Arrow key navigation** - Arrow keys work alongside vim-style hjkl bindings
- **Floating window rules UI** - Manage floating window rules directly in preferences
- **Screen edge margins** - Configurable gaps for compatibility with panels/docks
- **Additional keybindings** - Config reload, evenly distribute windows, workspace monocle, and more
- **More customization** - Border radius, tab margins, default layout, adjustable gap limits
- **Monitor exclusion** - Option to exclude specific monitors from tiling

### Bug Fixes

- Window resize and focus navigation fixes
- App-specific fixes for Chrome, Brave, Steam, Blender, ddterm, and others
- Stacked/tabbed container behavior improvements
- Preview hints and border rendering fixes
- Cross-workspace window operations
- Preferences saving and theme handling

### Code Quality

- Comprehensive unit test suite (1,400+ tests, ~88% line coverage) plus a Dockerized E2E suite
- Refactored architecture with focused, extracted managers (see [architecture docs](docs/dev/architecture.md))
- Riskier options stay behind clearly-marked experimental toggles

## Known Issues / Limitations

- Does not support dynamic workspaces
- Does not support vertical monitor setup

## Installation

Build from source:

```bash
# Install dependencies (Node.js 20+ and gettext required)
npm install

# Development build: compile and install to ~/.local/share/gnome-shell/extensions/
make dev

# Production build: compile, install, enable extension, restart shell
make prod
```

After installation, log out and log back in (or restart GNOME Shell on X11 with `Alt+F2`, then `r`).

![image](https://user-images.githubusercontent.com/348125/146386593-8f53ea8b-2cf3-4d44-a613-bbcaf89f9d4a.png)

## Documentation

Full docs live in [`docs/`](docs/):

- **User guide** ([`docs/user/`](docs/user/)) — [layouts & tiling](docs/user/layouts.md),
  [keybindings](docs/user/keybindings.md), [theming](docs/user/theming.md),
  [window rules](docs/user/rules.md), [portable config](docs/user/config.md),
  [multi-monitor](docs/user/monitors.md), [troubleshooting](docs/user/troubleshooting.md).
- **Developer reference** ([`docs/dev/`](docs/dev/)) — architecture, rendering
  pipeline, Mutter compatibility.
- Press **`Super+Shift+/`** in-session for the keybinding cheatsheet.

## Forge Override Paths

- Window rules: `$HOME/.config/forge/config/windows.json` — see [window rules](docs/user/rules.md) and [portable config](docs/user/config.md)
- Stylesheet: `$HOME/.config/forge/stylesheet/forge/stylesheet.css` — see [theming](docs/user/theming.md)

## GNOME Defaults

GNOME Shell has built in support for workspace management and seems to work well - so Forge will not touch those.

User is encouraged to bind the following:
- Switching/moving windows to different workspaces
- Switching to numbered, previous or next workspace

## Local Development Setup

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for environment setup, build/test commands, and code style. Run `make help` for the full list of targets.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and code style, and the
[upstream discussion](https://github.com/orgs/forge-ext/discussions/501) about the
path to merging this fork back into the main project.

## Credits

Thank you to:

- **The original Forge developers** - [@jmmaranan](https://github.com/jmmaranan) and all [upstream contributors](https://github.com/forge-ext/forge) who created this extension
- Michael Stapelberg/contributors for i3
- System76/contributors for pop-shell
- ReworkCSS/contributors for css-parse/css-stringify
