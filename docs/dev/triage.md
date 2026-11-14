# Triage: bead priority, type and labels

Rules for filing and re-rating beads (`bd create`, `bd update --priority`,
`bd update --type`). Priority and type are independent: **priority is the
consequence for Forge's users; type is the kind of change.** Neither says how much
work something is, how much we want it, or which project it belongs to. `bd ready`
sorts by priority, so an inflated band pushes real bugs down.

## Priority = consequence × reachability

| Band | Rule |
|------|------|
| **P0** | **Blocks all work.** `make check` or CI is red on `main`, `make dist` or the release workflow is broken. A state of the repo, not a bug severity. Rare and short-lived. |
| **P1** | **Breaks the session or the user's data, on a default setup.** GNOME Shell crashes, freezes, or is left with an input grab nothing dismisses. Forge loses or overwrites user state with no warning: a config file, a window rule, a GNOME setting it should have restored. Tiling doesn't work at all on a supported GNOME version. A regression since the last tag in a core command (tile, focus, move, swap, resize). A gate or test that cannot fail. |
| **P2** | **Visible misbehaviour, or P1 with narrowed reach.** A window lands in the wrong place, floats when it should tile, loses focus, or a command does nothing. A JS error that recovers. A leak that grows per window or per operation. A P1 consequence that needs a specific app, a non-default option, multiple monitors or one GNOME version to reach. |
| **P3** | **Latent bugs and hygiene that protects a live path.** A bug on a path nothing reaches today, or held off only by a caller's invariant. Fuzzer-only sequences. An e2e flake or harness gap. A coverage gap on a live path. Stale docs that would mislead. A feature someone has asked for that fits the project. |
| **P4** | **Dormant, defensive, cosmetic.** Defence-in-depth for a caller that doesn't exist yet, waiting on an upstream fix, naming, doc nits, wishlist features nobody plans to build. |

### Modifiers

Each moves one band at most. Say which one applied in the rationale line.

- **Reachability demotes.** One app, a non-default option, an uncommon setup: one
  band down. A dead or latent path: P3. Pure defence-in-depth: P4.
- **A workaround demotes.** A window rule, a setting or a re-enable gets the user
  out: one band down.
- **Blast radius promotes.** Every window, every GNOME version, every session:
  one band up. Never into P0.

### Decision ladder

Ask in order; stop at the first yes.

1. Does it stop `make check`, CI on `main` or the release? **P0.**
2. Does it crash or freeze the shell, strand an input grab, or lose user state,
   on a default setup? **P1.** Narrow reach: **P2.** Latent: **P3.**
3. Does a user see Forge do the wrong thing? **P2.** Latent: **P3.**
4. Is functionality missing? A fitting request: **P3.** Wishlist: **P4.**
5. Anything else is hygiene: **P3** if it protects a live path, **P4** if it is
   dormant or cosmetic.

## Type = kind of change

| Type | Use when | Usual band |
|------|----------|------------|
| `bug` | Forge does something other than what i3/sway, the docs or the code's own contract say. Includes flaky tests and gates that cannot fail. | P1–P3; P4 only when dormant |
| `chore` | No behaviour change: docs, comments, dead code, refactors, lint, test coverage for behaviour that already exists. | P3–P4, never P1 |
| `task` | Changes behaviour or produces knowledge but fixes no defect: investigations, data capture, migrations, harness work. | P2–P3, never P1 |
| `feature` | New capability: a command, a layout, a setting. | P3–P4 |
| `epic` | Container. Takes the band of its highest-priority open child. | — |

A task that is the fix for a bug is the bug's child, not a replacement for it.

## Labels

- `gh-import`: mirrors a GitHub issue (upstream or this fork). The issue is in the
  bead's external ref; reply there when the bead closes.
- `needs-data`: can't move until a reporter sends logs or a repro. Keeps its band;
  `bd ready --exclude-label needs-data` hides it from the work queue. Put what to
  capture in the bead's notes.

Don't add area or provenance labels; search and `bd list` cover them.

## Required rationale line

Every bug's description or notes end with one line:

```
Why P<n>: <consequence>, <reachability>
```

For example `Why P1: overwrites a GNOME setting on every disable, default config`
or `Why P3: tab-teardown throw, fuzzer-only sequence`. When a later reader
changes the band, append a note rather than editing silently:

```bash
bd note <id> "Severity P2->P3: <reason>"
```
