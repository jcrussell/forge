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

- Works on GNOME 40+ (X11 and Wayland)
- Tree-based tiling with vertical and horizontal split containers similar to i3-wm and sway-wm
- Vim-like keybindings for navigation/swapping windows/moving windows in the containers
- Drag and drop tiling
- Support for floating windows, smart gaps and focus hint
- Customizable shortcuts in extension preferences
- Some support for multi-display
- Tiling support per workspace
- Update hint color scheme from preferences
- Stacked tiling layout
- Swap current window with the last active window
- Auto Split or Quarter Tiling
- Show/hide tab decoration via keybinding
- Window resize using keyboard shortcuts

## Fork Improvements

This fork includes significant improvements over the upstream version:

### New Features

- **Keybindings cheatsheet overlay** - Quick reference for all shortcuts (`Super + ?`)
- **Portable config sync** - Export/import settings and keybindings for backup or sharing
- **Arrow key navigation** - Arrow keys work alongside vim-style hjkl bindings
- **Floating window rules UI** - Manage floating window rules directly in preferences
- **Screen edge margins** - Configurable gaps for compatibility with panels/docks
- **Additional keybindings** - Config reload, evenly distribute windows, workspace monocle, and more
- **More customization** - Border radius, tab margins, default layout, adjustable gap limits
- **Monitor exclusion** - Option to exclude specific monitors from tiling

### Bug Fixes (30+)

- Window resize and focus navigation fixes
- App-specific fixes for Chrome, Brave, Steam, Blender, ddterm, and others
- Stacked/tabbed container behavior improvements
- Preview hints and border rendering fixes
- Cross-workspace window operations
- Preferences saving and theme handling

### Code Quality

- Comprehensive unit test suite (823 tests, ~62% coverage)
- Refactored architecture with extracted modules (command.js, workspace.js, monitor.js)
- Experimental options disabled by default for stability

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

## Forge Override Paths

- Window Overrides: `$HOME/.config/forge/config/windows.json`
- Stylesheet Overrides: `$HOME/.config/forge/stylesheet/forge/stylesheet.css`

## GNOME Defaults

GNOME Shell has built in support for workspace management and seems to work well - so Forge will not touch those.

User is encouraged to bind the following:
- Switching/moving windows to different workspaces
- Switching to numbered, previous or next workspace

## Local Development Setup

- Install Node.js 20+
- Install `gettext`
- Run `npm install`
- Commands:

```bash
# Compile and install to extension directory
make dev

# Or run below, and restart the shell manually
make build && make debug && make install

# X11 - build from source and restarts gnome-shell
make test-x

# Wayland - build from source and starts a wayland instance (no restart)
make test-wayland

# Run unit tests
npm test

# Formatting (husky pre-commit hooks enforce this)
npm run format
```

## Contributing

See the [upstream discussion](https://github.com/orgs/forge-ext/discussions/501) about the path to merging this fork back into the main project.

## Credits

Thank you to:

- **The original Forge developers** - [@jmmaranan](https://github.com/jmmaranan) and all [upstream contributors](https://github.com/forge-ext/forge) who created this extension
- Michael Stapelberg/contributors for i3
- System76/contributors for pop-shell
- ReworkCSS/contributors for css-parse/css-stringify
