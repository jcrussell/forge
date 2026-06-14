# Forge E2E Testing Infrastructure

End-to-end tests for Forge run against real GNOME Shell inside Docker containers. Tests use D-Bus `Shell.Eval` to query window/extension state and `xdotool` for simulating keyboard and mouse input.

## Architecture

Each E2E container is a self-contained Fedora image with GNOME Shell and all test dependencies. The container runs systemd as PID 1 (required for `systemd-logind` and `org.freedesktop.locale1`), then `start-user-session.sh` launches Xvfb, a D-Bus session daemon, and GNOME Shell directly — without relying on systemd user services.

```
Host                          Container (systemd PID 1)
─────                         ──────────────────────────
make e2e-test
  └─ docker run -td ───────►  /usr/sbin/init
  └─ docker exec ──────────►  start-user-session.sh
                                 ├─ Xvfb :99
                                 ├─ dbus-daemon --session
                                 └─ gnome-shell --x11
  └─ docker exec ──────────►  set-env.sh run-tests.sh
                                 └─ pytest tests/
```

## Supported GNOME Versions

| Fedora | GNOME | Status |
|--------|-------|--------|
| 39 | 45 | Supported |
| 40 | 46 | Supported |
| 41 | 47 | Supported |
| 42 | 48 | Supported |
| 43 | 49 | Supported (default) |
| rawhide | 50 | Manual only (`make e2e-test GNOME_VERSION=50`) |

Rawhide is excluded from CI (`supported_fedora` in `gnome-versions.json`) to avoid breakage from upstream instability, but can be tested manually.

## Running Tests

```bash
# Run with default GNOME version (49)
make e2e-test

# Run with a specific GNOME version
make e2e-test GNOME_VERSION=47

# Run for all supported versions
make e2e-test-all

# Run only the fast multi-step "workflow" lane (see Test Lanes below)
make e2e-test-fast

# Record a screencast of the run (Wayland-only; forces the latest lane,
# F44/GNOME50). Writes e2e-results/recording.webm (VP8/WebM) with the current
# test name + firing action burned into each frame. Opt-in: the recording stack
# (pipewire/gstreamer) is build-arg gated, so other lanes' images are unchanged.
# Set FORGE_E2E_RECORD_ROUTE=B to use the Mutter.ScreenCast + pipewiresrc
# fallback instead of the default org.gnome.Shell.Screencast path.
#
# NOTE: recording only works on GNOME 50. The default Route A
# (org.gnome.Shell.Screencast) only finalizes a .webm on GNOME 50 — which is why
# e2e-test-record pins that lane; don't switch it. On GNOME 49 Route A aborts
# after the first test and writes no file, so there you must set
# FORGE_E2E_RECORD_ROUTE=B (Mutter.ScreenCast + pipewiresrc) to get a recording.
make e2e-test-record

# Interactive debugging (drops into bash inside the container)
make e2e-debug

# Clean up images and results
make e2e-clean

# List supported versions
make e2e-versions
```

## Test Lanes: atomic vs workflow

The suite has two coexisting lanes:

- **Atomic tests** (`test_<feature>.py`) — one operation per test, fresh windows per
  test. The pinpoint regression net; a failure names the exact behavior.
- **Workflow tests** (`test_workflow_<area>.py`, marked `@pytest.mark.workflow`) — one
  small window set driven through many sequenced operations (tile → relayout → resize →
  close → reopen → …). They amortize the ~10.5s-per-window launch cost across many
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
  sequences multiply the gates.
- For focus-dependent steps use `invoke_forge_action(..., focus_window=...)` (and
  `also_activate=True` for async-finalized actions like keyboard resize). Positional hints
  cannot disambiguate STACKED/TABBED children (shared rect) — target those via focus
  actions and assert on layout/path. With two same-class windows, read geometry via
  position-sorted rects, not class-based `WindowHelper` asserts.
- Keep each workflow self-contained (end in a clean tiled state); use `restore_settings`
  for any GSetting change.

## Adding a New GNOME Version

1. Add the Fedora-to-GNOME mapping in `gnome-versions.json` (`fedora_to_gnome`)
2. Add the Fedora version to `supported_fedora` if it should run in CI
3. Add the GNOME-to-Fedora mapping in the Makefile's `ifdef GNOME_VERSION` block
4. Update `SUPPORTED_FEDORA_VERSIONS` in the Makefile if added to CI

## Container Structure

| Path | Description |
|------|-------------|
| `/home/gnomeshell/.local/share/gnome-shell/extensions/forge@jmmaranan.com/` | Pre-installed Forge extension |
| `/app/tests/e2e/` | Test framework and test files |
| `/app/scripts/` | Shell scripts (run-tests.sh, lib.sh, etc.) |
| `/app/e2e-results/` | Test results and screenshots |
| `/usr/local/bin/start-user-session.sh` | Launches Xvfb + D-Bus + GNOME Shell |
| `/usr/local/bin/set-env.sh` | Sets `DBUS_SESSION_BUS_ADDRESS` and `DISPLAY` for test commands |

### Key Scripts

- **`start-user-session.sh`** — Root script that creates the XDG runtime directory, starts Xvfb, launches a D-Bus session daemon, pre-enables Forge via gsettings, and starts GNOME Shell in X11 mode. Waits for Shell.Eval to confirm readiness.
- **`set-env.sh`** — Lightweight wrapper that exports `DBUS_SESSION_BUS_ADDRESS` and `DISPLAY`, then `eval`s its arguments. Used to run commands in the gnomeshell user's D-Bus session.
- **`run-tests.sh`** — Waits for GNOME Shell and Forge to be ready, then runs pytest.
- **`lib.sh`** — Shared functions: `wait_for_shell`, `wait_for_forge_extension`, `check_forge_extension`, `print_system_info`.

## Test Framework

- **`framework/shell_proxy.py`** — `ShellProxy` class that communicates with GNOME Shell via D-Bus `org.gnome.Shell.Eval`. Executes JavaScript in the Shell process to query extension state, window properties, and tree structure.
- **`framework/input_simulator.py`** — `InputSimulator` class wrapping `xdotool` for keyboard shortcuts, mouse clicks, and window focus simulation.
- **`framework/window_helper.py`** — `WindowHelper` with higher-level operations: open windows, arrange layouts, verify tiling state.
- **`framework/constants.py`** — Shared constants (timeouts, extension UUID, key names).
- **`framework/workflow.py`** — Helpers for the workflow lane: `step()` (per-step screencast label + failure annotation) and `invoke_resize()` (deterministic keyboard-resize driver, also used by the atomic resize tests).

## Known Issues / Deferred

- **Keybinding-dispatch lane is not fully green (deferred — forge-er8).** Input is
  dispatched two ways, selected by `--dispatch-mode`: `dbus` (default — actions invoked
  directly via `org.gnome.Shell.Eval`, the trustworthy lane CI gates on) and `keybinding`
  (synthetic super-modifier keypresses via Clutter's `VirtualInputDevice`). The keybinding
  path is inherently contaminated in a shared session: Mutter tile-snaps the focused window
  at keypress time and the latch crosses test boundaries (no GJS teardown can clear it). CI
  therefore runs only a single gating keybinding test (`test_focus_left_right`); a full green
  keybinding lane would require per-test container isolation (a CI/runner change with a large
  wall-clock cost), which is deferred. Tests that strengthen focus/movement assertions keep a
  weaker check under `keybinding` so the gate stays green (see `test_focus_navigation.py`).

- **Drag-drop tiling has no real headless grab coverage (deferred — forge-v9o7).** The
  drop pipeline (`grab-op-begin` → `GRAB_TILE` → `_handleMoving` → `moveWindowToPointer`)
  only engages on a real Mutter move grab. Synthetic drags — xdotool mousedown+motion on
  X11 and Clutter `VirtualInputDevice` on headless Wayland — fire **zero** `grab-op-begin`
  signals (verified live on both lanes), so no drop ever lands. The tests in
  `test_drag_drop_tiling.py` therefore assert only on settle-state geometry and `xfail`
  their landing gate (visible-gap, not skip) rather than passing vacuously. Real coverage
  would need a programmatic grab (`begin_grab_op` is not driven from GJS today) or
  `gnome-ponytail-daemon` (not integrated); both are deferred. Until then the drop-decision
  logic is best covered by unit tests (mocked GNOME APIs), not this lane.

The containerized GNOME Shell testing approach, Dockerfile setup (Fedora base image, `gnomeshell` user, systemd configuration, `systemd-logind` override), and `set-env.sh` script are derived from [gnome-shell-pod](https://github.com/Schneegans/gnome-shell-pod) by Simon Schneegans, licensed under the MIT License.
