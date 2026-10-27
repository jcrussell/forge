# Contributing to Forge

Thanks for helping out! This is an AI-maintained fork of
[Forge](https://github.com/forge-ext/forge); fixes here are intended to be
upstreamed when possible.

## Prerequisites

- **Node.js 20+** and **gettext**
- A GNOME Shell 45+ session for manual testing (X11 or Wayland)

## Set up & build

```bash
npm install        # dependencies + git hooks

make dev           # compile schemas + install to ~/.local/share/gnome-shell/extensions/
make prod          # like dev, then enable + restart shell
```

Apply changes: on X11, `Alt+F2` → `r` → Enter; on Wayland, log out/in — or use a
nested session that needs no restart:

```bash
make test          # build + launch a nested Wayland GNOME Shell (no restart needed)
make test-x        # build + restart gnome-shell (X11)
make log           # tail Forge's logs
```

## Tests

```bash
npm test                 # unit tests (Vitest, mocked GNOME APIs)
make unit-test-docker    # the same, in the canonical Docker environment
make e2e-test            # end-to-end tests against real GNOME Shell in Docker
```

- Unit-test guide (fixtures, mocks, avoiding vacuous tests):
  [tests/README.md](tests/README.md).
- E2E infrastructure: [tests/e2e/README.md](tests/e2e/README.md).

New behavior should come with a test. Unit tests must drive real `lib/` code, not
reimplement it — a test that can't go red when you break the code under test isn't
testing anything.

## Code style

- **Prettier**, 2-space indent, 100-char width. Run `npm run format`; `npm run lint`
  checks. A pre-commit hook formats staged files and runs the related unit tests, so
  commits are gated automatically.
- Match the surrounding code's naming and idioms.
- Core classes are `GObject`s registered with the
  `static { GObject.registerClass(this); }` pattern; track signal IDs and disconnect
  them on teardown (see [docs/dev/architecture.md](docs/dev/architecture.md)).

## Understanding the codebase

Start with [docs/dev/](docs/dev/): architecture (lifecycle, tree model, dispatch,
signal discipline), rendering (the placement pipeline), and compat (Mutter version
shims). The user-facing behavior is documented in [docs/user/](docs/user/).

## Translations

User-facing strings are wrapped in `_("...")` and localized with gettext. When you
add or change a string, run `make update-pot` and commit `po/forge.pot`. Catalogs
(`po/<lang>.po`) are currently maintained manually via `make update-po`; crowd-sourced
translation through Weblate is planned but not yet active (pending upstreaming).
Full workflow: [docs/dev/translations.md](docs/dev/translations.md).

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
- `npm test`, `npm run lint`, `npm run lint:src` and `npm run typecheck` pass (the
  pre-commit hook runs them).
- Docs, version lists and the CI matrix are updated if the change affects them.

### Shape of the PR

- Branch off `main`. Make **one concern per commit**, so each change can be accepted
  on its own. Bundled PRs are judged commit by commit.
- Fill in the [PR template](.github/pull_request_template.md). It asks for the root
  cause and why you chose that layer.
- Commit messages say what changed and why, not the story of how you got there.
- Your PR is rebased onto `main` and lands with linear history. Clean commits that
  each pass the tests are kept as you wrote them. Messy commits are squashed, one
  commit per change. Either way you stay the author.

## Releasing

Maintainers: cutting a release and submitting to extensions.gnome.org is
documented in [RELEASING.md](RELEASING.md).

> Maintainers: this repo tracks work with **bd** (beads) and additional automation
> conventions documented in [AGENTS.md](AGENTS.md).
