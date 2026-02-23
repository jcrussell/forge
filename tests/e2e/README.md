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

# Interactive debugging (drops into bash inside the container)
make e2e-debug

# Clean up images and results
make e2e-clean

# List supported versions
make e2e-versions
```

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

## Attribution

The containerized GNOME Shell testing approach, Dockerfile setup (Fedora base image, `gnomeshell` user, systemd configuration, `systemd-logind` override), and `set-env.sh` script are derived from [gnome-shell-pod](https://github.com/Schneegans/gnome-shell-pod) by Simon Schneegans, licensed under the MIT License.
