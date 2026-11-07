# AGENTS.md

Guidance for AI coding agents in this repository. `CLAUDE.md` imports this file; edit it here.

Forge is a GNOME Shell extension (GNOME 45–51, X11 and Wayland) that tiles windows
i3/sway-style. Entry points are `extension.js` and `prefs.js`; the code is in `lib/`.

- **Setup, build, test, style:** [CONTRIBUTING.md](CONTRIBUTING.md). `make check` must
  pass.
- **How the code works:** [docs/dev/](docs/README.md#developer-reference). Read
  [hazards.md](docs/dev/hazards.md) before touching window, actor, signal or timer code.
- **Tests:** [tests/README.md](tests/README.md) and [tests/e2e/README.md](tests/e2e/README.md).
- **User-facing behavior:** [docs/user/](docs/README.md#user-guide). Update it when
  behavior changes.

## Making changes

Before implementing, read **[CONTRIBUTING.md § Getting your change merged](CONTRIBUTING.md#getting-your-change-merged)**. It is the rubric every PR is reviewed against: fit, mechanism (fix the root cause using the mechanism that already exists, at the right layer) and correctness. Build to it and the change merges as-is. Put one concern in each commit and fill in `.github/pull_request_template.md`.

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

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. Sync with `bd dolt push` / `bd dolt pull`; a fresh clone runs `bd bootstrap`. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

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
   bd dolt push
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
