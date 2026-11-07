# E2E tests

The e2e suite runs pytest against a real GNOME Shell in a self-contained Fedora
container: systemd as PID 1, then `start-user-session.sh` starts D-Bus and the shell
(X11 on Xvfb for Fedora 39–42, headless Wayland from 43, whose shell has no X11).
Tests read state and invoke Forge actions through D-Bus `Shell.Eval`
(`framework/bridge.js`), and send input through Clutter virtual devices or xdotool.
`framework/` and `apps/` hold the helpers; each module's docstring says what it is
for.

The lanes and their GNOME versions are in [`gnome-versions.json`](gnome-versions.json);
CI runs every `supported_fedora` entry.

```bash
make e2e-test                    # default lane (GNOME 48 / Fedora 42)
make e2e-test GNOME_VERSION=50   # one version
make e2e-test-all                # every supported version
make e2e-debug                   # shell inside the container
```

The Makefile has the rest (lanes, fuzzing, recording); results land in
`e2e-results/`, mounted in the container as `/app/e2e-results`.
`make e2e-test-record` writes a screencast to `e2e-results/recording.webm`; it is
pinned to GNOME 50, the only lane where its capture route finalizes a file.

## Lanes: atomic and workflow

The suite has two coexisting lanes:

- **Atomic tests** (`test_<feature>.py`) — one operation per test, fresh windows per
  test. The pinpoint regression net; a failure names the exact behavior.
- **Workflow tests** (`test_workflow_<area>.py`, marked `@pytest.mark.workflow`) — one
  small window set driven through many sequenced operations (tile → relayout → resize →
  close → reopen → …). They amortize the per-window launch and settle cost across many
  assertions and exercise realistic state transitions the atomic tests never cover.

Both lanes run on every `make e2e-test`, with **workflows ordered first** (a stable sort
in `pytest_collection_modifyitems`) so an obviously-broken build fails on the cheap lane
before paying for atomic launches. Select a lane explicitly:

```bash
make e2e-test-fast                 # only the workflow lane (fast inner loop)
# inside the container / pytest:
pytest -m workflow                 # workflow lane only
pytest -m "not workflow"           # atomic lane only
```

Workflows are not a superset of the atomic tests — bug-specific regressions, dialogs,
multi-monitor, config-reload, maximize-compat, drag-drop and settings edge cases stay
atomic-only, so the atomic lane must keep running by default.

### Authoring a workflow

- Launch the window set once (reuse `two_windows`/`three_windows`/`launch_window`), then
  sequence operations; wrap each in `with step(shell_proxy, "label"):` from
  `framework/workflow.py`. `step()` labels the screencast (when recording) and annotates
  any failure with the step name without disturbing pytest's assert introspection. Use it
  for assertion-only / raw `invoke_forge_action` steps — bare `input_sim.*` calls already
  self-label on the recording lane.
- **End every state-changing step in a `wait_for_*`** on its own post-condition — there is
  no flake-rerun plugin, so this polling is the only stability mechanism, and longer
  sequences multiply the gates. Forge applies most changes on a later main-loop turn (a
  200ms window-create wait, the 220ms event queue, idle renders):
  `shell_proxy.wait_for_forge_settled()` waits until it has nothing pending, and the
  window fixtures and `restore_settings` writes already end with it. It covers Forge's
  side only: for geometry, `shell_proxy.wait_for_layout_landed()` also waits for its
  moves to land.
- For focus-dependent steps use `invoke_forge_action(..., focus_window=...)` (and
  `also_activate=True` for async-finalized actions like keyboard resize). Positional hints
  cannot disambiguate STACKED/TABBED children (shared rect) — target those via focus
  actions and assert on layout/path. With two same-class windows, read geometry via
  position-sorted rects, not class-based `WindowHelper` asserts.
- Keep each workflow self-contained (end in a clean tiled state); use `restore_settings`
  for any GSetting change.

## Fuzzing

The atomic and workflow lanes only exercise sequences a human wrote. The **fuzzer**
(`tests/e2e/fuzz/`) instead generates *seeded random* action sequences against the real
headless shell and, after every step, checks invariants that must hold for *any* correct
tree. It explores the unanticipated interleavings hand-written tests miss.

```bash
make e2e-fuzz                                   # default: 1 session, 30 steps, seed 1
make e2e-fuzz FORGE_FUZZ_SESSIONS=2 FORGE_FUZZ_STEPS=40
make e2e-fuzz FORGE_FUZZ_SEED=12345             # reproduce a specific session
# Campaign: many large sessions, don't abort on the first crash — collect every
# repro and fail once at the end with a summary (good for unattended sweeps).
make e2e-fuzz FORGE_FUZZ_CONTINUE=1 FORGE_FUZZ_SHRINK=0 \
              FORGE_FUZZ_SESSIONS=10 FORGE_FUZZ_STEPS=1000
# New windows append flat by default; auto-split builds deep nested trees. Run both:
make e2e-fuzz FORGE_FUZZ_AUTOSPLIT=1     # ON  — deep nested trees
make e2e-fuzz FORGE_FUZZ_AUTOSPLIT=0     # OFF — flat fan (the historical default)
```

Each session prints its peak achieved shape — `maxDepth nodes cons fanout` — so you can see
whether a run actually built deep trees (the ON band should show clearly higher `maxDepth`).
`FORGE_FUZZ_WINDOWS` (default 4) sets the initial window count.

It is **opt-in**: marked `fuzz` and excluded from `make e2e-test` (run-tests.sh adds
`-m "not fuzz"` by default).

**How it works**

1. **Generate** — `fuzz/actions.py` emits fully-concrete, JSON-serializable steps from a
   seeded `random.Random`. Tiling commands (focus/move/swap/split/layout/resize/snap/gap/
   float) at high weight, **workspace/global toggles** (tile-whole-workspace, monocle, global
   tiling-mode on/off),
   **window-state** ops (minimize/unminimize, fullscreen/unfullscreen — raw Meta.Window state
   that leaves/rejoins the tile tree), **misc command toggles** (show-tab-decoration, float-by-
   class, config-reload), **drag-drop tile** (drag a window onto a zone of another — the only path
   keybindings can't reach), and **lifecycle chaos** (spawn/close/workspace-switch) at low weight.
   Actions carry a positional focus hint (`leftmost`/…) so a step targets the same window
   on replay. Dispatch is D-Bus (`invoke_forge_action`), which avoids Mutter's
   tile-snap latch on synthetic keys.
2. **Settle** — after each step the engine first waits for Forge's async work to
   drain (`shell_proxy.wait_for_forge_settled` / `bridge.pendingWork`: the `wm.queueEvent`
   queue, pending idle renders and one-shot timers — Move/SnapLayoutMove finalize ~220ms
   later), then forces a **synchronous** `tree.render()`
   (`bridge.fuzzRenderNow`). `command()` only *queues* an idle render, so a naive read
   races the pre-`cleanTree` tree; draining + the forced render is the positive settle.
3. **Oracle** (`bridge.fuzzCheckInvariants` + log scan) — liveness probe, then the
   **sound** rule set, then a scan of the live `/tmp/gnome-shell.log` for new
   `JS ERROR` / finalized-object lines. A re-readable structure/geometry hit is re-checked
   once after an extra settle to drop transients; a log/dead-shell hit is **authoritative**
   on first sight (the log offset has already advanced, so it cannot be re-read).
4. **Repro + shrink** — a failure is saved to `e2e-results/fuzz/repro-<seed>.json`, then
   ddmin-minimised (`fuzz/shrink.py`) to `…min.json`. Because the shell is **not
   bit-deterministic** (launch races, Mutter re-focus on close), each shrink candidate is
   replayed **K times** (`reproduces`); a chunk is dropped only if a **majority** of K still
   reproduce, and the final minimal sequence is re-validated. Repros are therefore
   **best-effort**, not guaranteed bit-reproducible.

**Sound invariants checked** — parent-ref consistency, true cycle detection (visited-set,
not a depth heuristic), nodeType + layout domain, no empty CON, no CON wrapping a single
CON, WINDOW nodes are leaves, no two WINDOW nodes share a `Meta.Window`, and tiled-sibling
non-overlap under HSPLIT/VSPLIT. The overlap set comes from the shell's own
`getTiledChildren` (an all-floated CON keeps a stale rect and is correctly excluded);
STACKED/TABBED are skipped (their children share a rect by design).

**Deliberately NOT invariants** — do not re-add these; the code contradicts them:

- *child percents sum to 1.0* — `computeSizes` sizes each child independently; floats keep
  stale percents.
- *no CON with 0 tiled children* — `cleanTree` keys on `childNodes.length`, so an
  all-floated/minimized CON legitimately survives.
- *no single-WINDOW-child CON* — `cleanTree` only flattens a CON whose lone child is a CON.

**Promoting a fuzz bug to a regression test** — commit the minimal repro and point the
replay test at it:

```bash
make e2e-fuzz FORGE_FUZZ_REPLAY=/app/e2e-results/fuzz/repro-5.min.json
```

`test_fuzz_replay` replays the saved step list and asserts the recorded rule reproduces.

## Adding a New GNOME Version

All of these move together:

1. Add the Fedora-to-GNOME mapping in `gnome-versions.json` (`fedora_to_gnome`).
   `run-tests.sh` fails any lane whose running shell major differs from this entry.
2. Add the Fedora version to `supported_fedora` if it should run in CI
3. Add the GNOME-to-Fedora mapping in the Makefile's `ifdef GNOME_VERSION` block
4. Update `SUPPORTED_FEDORA_VERSIONS` in the Makefile if added to CI
5. Add the new shell major to `metadata.json`'s `shell-version` array — without it the
   extension refuses to load on that shell
6. Update the Fedora-to-GNOME comment blocks, which are duplicated in four files:
   `Makefile`, `docker/Dockerfile.e2e`, `docker/docker-compose.e2e.yml` and
   `.github/workflows/e2e-testing.yml`
7. Update the `e2e-versions` help text in the Makefile
8. If the *default* lane moves, change it in all three places at once: `FEDORA_VERSION`
   in the Makefile, `ARG FEDORA_VERSION` in `docker/Dockerfile.e2e`, and the
   `${FEDORA_VERSION:-NN}` defaults in `docker/docker-compose.e2e.yml`

## Formatting

Python here is formatted and linted with ruff (`ruff.toml`); install it with
`pip install -r tests/e2e/requirements.txt`. `make check` and the pre-commit hook
run it.

## Known gaps

- **The keybinding-dispatch lane is not fully green.** Input is
  dispatched two ways, selected by `--dispatch-mode`: `dbus` (default — actions invoked
  directly via `org.gnome.Shell.Eval`, the trustworthy lane CI gates on) and `keybinding`
  (synthetic super-modifier keypresses via Clutter's `VirtualInputDevice`). The keybinding
  path is inherently contaminated in a shared session: Mutter tile-snaps the focused window
  at keypress time and the latch crosses test boundaries (no GJS teardown can clear it). CI
  therefore runs only a single gating keybinding test (`test_focus_left_right`); a full green
  keybinding lane would require per-test container isolation (a CI/runner change with a large
  wall-clock cost), which is deferred. Tests that strengthen focus/movement assertions keep a
  weaker check under `keybinding` so the gate stays green (see `test_focus_navigation.py`).

- **Drag-drop tiling has no real headless grab coverage.** The
  drop pipeline (`grab-op-begin` → `GRAB_TILE` → `_handleMoving` → `moveWindowToPointer`)
  only engages on a real Mutter move grab. Synthetic drags — xdotool mousedown+motion on
  X11 and Clutter `VirtualInputDevice` on headless Wayland — fire **zero** `grab-op-begin`
  signals (verified live on both lanes), so no drop ever lands. The tests in
  `test_drag_drop_tiling.py` therefore assert only on settle-state geometry and `xfail`
  their landing gate rather than passing vacuously. Real coverage needs a programmatic
  grab or `gnome-ponytail-daemon`; until then unit tests cover the drop logic.

The containerized GNOME Shell testing approach, Dockerfile setup (Fedora base image, `gnomeshell` user, systemd configuration, `systemd-logind` override), and `set-env.sh` script are derived from [gnome-shell-pod](https://github.com/Schneegans/gnome-shell-pod) by Simon Schneegans, licensed under the MIT License.
