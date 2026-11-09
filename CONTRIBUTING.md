# Contributing to Forge

## Set up

Needs Node.js 20+, python3, `glib-compile-schemas`, [ruff](https://docs.astral.sh/ruff/)
(for `make check`) and a GNOME Shell 45+ session; gettext for translations and Docker
for the e2e tests.

```bash
npm install        # dependencies and git hooks
make dev           # debug build, installed to ~/.local/share/gnome-shell/extensions/
make test          # debug build in a nested Wayland shell, no log-out needed
make log           # follow Forge's log
```

`make help` lists the common targets. After `make dev`, log out and in to load the
build; the first time, also `make enable`.

## Test

```bash
npm test           # unit tests: Vitest, mocked GNOME APIs
make e2e-test      # e2e tests: real GNOME Shell in Docker
make check         # ruff, Prettier, ESLint, typecheck, unit tests
```

How to write tests that can fail: [tests/README.md](tests/README.md) (unit) and
[tests/e2e/README.md](tests/e2e/README.md) (e2e). To find your way around the code,
start at [docs/](docs/README.md#developer-reference).

## Style

Prettier (2-space indent, 100 columns; `npm run format`) and ESLint, including the
repo rules in `eslint-rules/` ([hazards.md](docs/dev/hazards.md)). Match the
surrounding code. Wrap user-facing strings in `_()` and run `make update-pot`
([translations.md](docs/dev/translations.md)).

## Getting your change merged

Every PR (human- or agent-written) is reviewed against this section, and each
change in it ends in one of four outcomes:

| Outcome          | When                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| **Merge as-is**  | Fits the project, right mechanism, tested. Your commits land unchanged.   |
| **Fix-merge**    | Right idea and mechanism, small gaps. Your commits land plus one maintainer follow-up commit. |
| **Reimplement**  | Right idea, wrong mechanism. The maintainer rewrites it and credits you with `Co-authored-by`; the PR is closed. |
| **Decline**      | Doesn't fit the project. The PR is closed with the reason.                |

If you (or your agent) build to the three checks below, you get **Merge as-is**.

### 1. Fit

- Does it behave like i3/sway would? Forge follows i3/sway semantics.
- Does it work on GNOME 45+ on both X11 and Wayland?
- Is it worth maintaining? Choose the smallest change that solves a real problem.
  Speculative options, settings and abstractions get declined.

Not sure? Open an issue first.

### 2. Mechanism

Most fixes are judged on this check. A change that fixes the right thing in the
wrong way is reimplemented.

- **Fix the root cause, not the symptom.** State the cause in one sentence. A
  timeout or idle delay, retry, swallowed `try/catch`, extra null guard or one-off
  flag that only hides the failure is a symptom patch.
- **Use the mechanism that already exists** instead of adding a parallel cache,
  state flag or event path:

  | Problem                                   | Mechanism                                                    |
  | ----------------------------------------- | ------------------------------------------------------------ |
  | Mutter/Shell API differs between versions | a `Compat` shim in `compat.js` ([compat.md](docs/dev/compat.md)) |
  | Window position/size is wrong             | the render pipeline and `move()` ([rendering.md](docs/dev/rendering.md)) |
  | Layout or structure is wrong              | tree mutations in `tree.js` ([architecture.md](docs/dev/architecture.md)) |
  | New user action                           | command dispatch ([architecture.md](docs/dev/architecture.md#command-dispatch-flow)) |
  | Signals, timers, actors                   | tracked IDs released in `disable()` ([hazards.md](docs/dev/hazards.md)) |
  | Per-user behavior                         | GSettings or the config files ([architecture.md](docs/dev/architecture.md#configuration-sources)) |

- **Fix it at the right layer.** A tree bug gets fixed in the tree, not
  special-cased in a command handler or a signal callback.
- **Fix the whole class.** If the bug belongs to a class in
  [hazards.md](docs/dev/hazards.md), fix every site that has it, and add or extend
  the guardrail (an ESLint rule in `eslint-rules/`, a shim or a test) so it can't
  come back.

### 3. Correctness

- The new tests fail without your change and pass with it. Use a unit test that drives
  real `lib/` code ([tests/README.md](tests/README.md)), or an e2e test when the bug
  only shows in a real shell.
- `make check` passes. The pre-commit hook formats and lints staged files and runs
  related tests; the pre-push hook runs `make check` on the working tree, so commit
  or stash unfinished work first. CI also enforces the coverage floor, builds the zip and runs
  the e2e lanes.
- Docs, version lists and the CI matrix are updated if the change affects them.

### Shape of the PR

- Branch off `main`. Make **one concern per commit**, so each change can be accepted
  on its own. Bundled PRs are judged commit by commit.
- Fill in the [PR template](.github/pull_request_template.md). It asks for the root
  cause and why you chose that layer.
- Commit messages follow [the format below](#commit-messages).
- Your PR is rebased onto `main` and lands with linear history. Clean commits that
  each pass the tests are kept as you wrote them. Messy commits are squashed, one
  commit per change. Either way you stay the author.

### Commit messages

```text
type(scope): what changed

Why it changed and what the code does now, not the story of how you got there.

Closes forge-xxxx
Co-authored-by: Name <email>
```

The [release notes](RELEASING.md#release-notes) are built from subjects, so the
type decides where a commit is listed. A subject without a type lands under
**Other**.

| Type                                              | Release notes                |
| ------------------------------------------------- | ---------------------------- |
| `feat`                                            | Features                     |
| `fix`                                             | Bug Fixes                    |
| `docs`, `i18n`                                    | Documentation & Translations |
| any other, e.g. `test`, `refactor`, `chore`, `ci` | Maintenance (collapsed)      |

- **Scope** is optional: the area touched, e.g. `fix(window):`, `feat(prefs):`.
- **Breaking change:** add `!` after the type or scope (`feat!:`), which also lists
  the commit under Breaking Changes. A `BREAKING CHANGE:` footer alone isn't picked up.
- **Trailers:** `Closes <id>` for the issue the commit fixes (a bd id, or `#123` for a
  GitHub issue), or `Refs <id>` if it only relates to one. `Co-authored-by` credits
  everyone else who wrote it, and they're listed as contributors in the release notes.

## Maintainers

[RELEASING.md](RELEASING.md) covers releases. Work is tracked with bd (beads); see
[AGENTS.md](AGENTS.md).
