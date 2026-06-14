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

Forge models each workspace's windows as an i3/sway-style **tree** and reconciles it onto the screen. Entry points: `extension.js` (lifecycle) and `prefs.js` (GTK4/Adwaita preferences).

Core modules (`lib/extension/`): **tree.js** (Node/Tree data model, node + layout types), **window.js** (WindowManager — signals, tiling, focus, grab, `renderTree`), **command.js** (CommandHandler — action dispatch), **workspace.js** / **monitor.js** (per-workspace/monitor node + signal managers), **keybindings.js** (vim-like shortcuts), **cheatsheet.js** (in-shell help overlay), **indicator.js** (quick settings), **utils.js**, **enum.js**. Shared (`lib/shared/`): **settings.js** (ConfigManager + `windows.json` overrides), **config-sync.js** (GSettings ⇄ portable JSON), **logger.js**, **theme.js** (+ `lib/css/`). GSettings schema: `schemas/org.gnome.shell.extensions.forge.gschema.xml`. Prefs UI (`lib/prefs/`) is GTK4/Adwaita, not unit-tested.

See **[docs/dev/](docs/dev/)** for the detailed reference: [architecture.md](docs/dev/architecture.md) (lifecycle, tree model, command dispatch, signal/cleanup discipline, config sources), [rendering.md](docs/dev/rendering.md) (render/placement pipeline, reload triggers, floating subsystem, theme engine), [compat.md](docs/dev/compat.md) (Mutter API drift + shim recipe).

## Testing Infrastructure

- **Unit tests** — Vitest with mocked GNOME APIs (`tests/mocks/`); run `npm test`, or `make unit-test-docker` for the canonical Docker environment. Structure, mock helpers, and how to write non-vacuous tests: **[tests/README.md](tests/README.md)**.
- **E2E tests** — real GNOME Shell in self-contained Fedora Docker containers (D-Bus `Shell.Eval` + xdotool); run `make e2e-test` (default GNOME 49), `make e2e-test GNOME_VERSION=<n>`, or `make e2e-test-all`. Supported versions in `tests/e2e/gnome-versions.json`. Full infrastructure docs: **[tests/e2e/README.md](tests/e2e/README.md)**.

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
