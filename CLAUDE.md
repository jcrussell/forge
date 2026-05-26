# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Forge is a GNOME Shell extension providing i3/sway-style tiling window management. It supports GNOME 40+ on both X11 and Wayland, featuring tree-based tiling with horizontal/vertical split containers, stacked/tabbed layouts, vim-like keybindings, drag-and-drop tiling, and multi-monitor support.

## Build & Development Commands

```bash
# Install dependencies (Node.js 20+ and gettext required)
npm install

# Development build: compile, set debug mode, install to ~/.local/share/gnome-shell/extensions/
make dev

# Production build: compile, install, enable extension, restart shell
make prod

# Testing in nested Wayland session (no shell restart needed)
make test

# Testing on X11 (restarts gnome-shell)
make test-x

# Unit tests (mocked GNOME APIs via Vitest)
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report

# Code formatting
npm run format              # Format code with Prettier
npm run lint                # Check formatting

# View extension logs
make log
```

For Wayland nested testing, use `make test-open` to launch apps in the nested session.

## Architecture

### Entry Points

- `extension.js` - Main extension entry point, creates ForgeExtension class that manages lifecycle
- `prefs.js` - Preferences window entry point (GTK4/Adwaita)

### Core Components (lib/extension/)

- **tree.js** - Tree data structure for window layout (central to tiling logic)
  - `Node` class: Represents monitors, workspaces, containers, and windows in a tree hierarchy
  - `Tree` class: Manages the entire tree structure, handles layout calculations
  - `Queue` class: Event queue for window operations
  - Node types: ROOT, MONITOR, WORKSPACE, CON (container), WINDOW
  - Layout types: HSPLIT, VSPLIT, STACKED, TABBED, PRESET

- **window.js** - WindowManager class, handles window signals, grab operations, tiling logic, and focus management

- **command.js** - CommandHandler class, processes keyboard and action commands (extracted from window.js)

- **workspace.js** - WorkspaceManager class, handles workspace nodes and signal lifecycle (extracted from tree.js/window.js)

- **monitor.js** - MonitorManager class, handles monitor nodes per workspace (extracted from tree.js)

- **keybindings.js** - Keyboard shortcut management (vim-like hjkl navigation)

- **utils.js** - Utility functions for geometry calculations, window operations

- **enum.js** - `createEnum()` helper for creating frozen enum objects

- **indicator.js** - Quick settings panel integration

### Shared Modules (lib/shared/)

- **settings.js** - ConfigManager for loading window overrides from `~/.config/forge/config/windows.json`
- **logger.js** - Debug logging (controlled by settings)
- **theme.js** - ThemeManagerBase for CSS parsing and stylesheet management

### Preferences UI (lib/prefs/)

GTK4/Adwaita preference pages - not covered by unit tests.

### GSettings Schemas

Located in `schemas/org.gnome.shell.extensions.forge.gschema.xml`. Compiled during build.

## Testing Infrastructure

Tests use Vitest with mocked GNOME APIs (tests/mocks/gnome/). The mocks simulate Meta, Gio, GLib, Shell, St, Clutter, and GObject APIs so tests can run in Node.js without GNOME Shell.

**Always run tests in Docker** to ensure consistent environment:

```bash
# Run all tests in Docker (preferred)
make unit-test-docker

# Run with coverage report
make unit-test-docker-coverage

# Watch mode for development
make unit-test-docker-watch

# Run locally (if Node.js environment matches)
npm test
npm run test:coverage
```

Test structure:
- `tests/setup.js` - Global test setup, loads mocks
- `tests/mocks/gnome/` - GNOME API mocks (Meta.js, GLib.js, etc.)
- `tests/mocks/helpers/` - Test helpers like `createMockWindow()`
- `tests/unit/` - Unit tests organized by module
- `tests/regression/` - Bug regression tests

### E2E Testing (Real GNOME Shell)

E2E tests run against real GNOME Shell in self-contained Docker containers built from Fedora base images. Tests use D-Bus `Shell.Eval` to query window state and xdotool for input simulation.

Supported GNOME versions are defined in `tests/e2e/gnome-versions.json`.

```bash
# Run E2E tests (default GNOME 49)
make e2e-test

# Run for specific GNOME version
make e2e-test GNOME_VERSION=47
make e2e-test GNOME_VERSION=48

# Run for all supported versions
make e2e-test-all

# List supported versions
make e2e-versions

# Interactive debugging in container
make e2e-debug

# Clean E2E artifacts
make e2e-clean
```

E2E test structure:
- `tests/e2e/framework/` - Testing utilities (ShellProxy, InputSimulator, WindowHelper)
- `tests/e2e/tests/` - Test scenarios (basic tiling, focus, swap, layout, float)
- `tests/e2e/README.md` - Detailed E2E infrastructure documentation
- `docker/Dockerfile.e2e` - Self-contained container definition (Fedora base)
- `docker/scripts/` - Test runner and session management scripts

## Key Concepts

- **Tiling tree**: Windows are organized in a tree structure similar to i3/sway. Containers can split horizontally or vertically, or display children in stacked/tabbed mode.

- **Window modes**: TILE (managed by tree), FLOAT (unmanaged), GRAB_TILE (being dragged), DEFAULT

- **Session modes**: Extension disables keybindings on lock screen but keeps tree in memory to preserve layout

- **GObject Classes**: All core classes extend GObject with `static { GObject.registerClass(this); }` pattern.

- **Signal Connections**: Track signal IDs for proper cleanup in disable().

## Configuration Files

- GSettings schema: `org.gnome.shell.extensions.forge`
- Window overrides: `~/.config/forge/config/windows.json`
- Stylesheet overrides: `~/.config/forge/stylesheet/forge/stylesheet.css`

## Code Style

- Prettier with 2-space indentation, 100-char line width
- Husky pre-commit hooks enforce formatting
- Use `npm run format` before committing

## Branches

- `main` - GNOME 40+ (current development)
- `legacy`/`gnome-3-36` - GNOME 3.36 support (feature-frozen)


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
