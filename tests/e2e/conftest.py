"""
Pytest fixtures for Forge E2E tests.

Provides fixtures for shell proxy, input simulator, window helper,
and other testing utilities.
"""

import os
import subprocess
import time
import warnings
from pathlib import Path
from typing import Generator, Optional

import pytest
from framework.constants import (
    APP_PALETTE,
    DEFAULT_TEST_APP,
    DEFAULT_TEST_APP_ARGS,
    FORGE_UUID,
    Timeout,
    Timing,
)
from framework.gsettings import ForgeSettings
from framework.input_simulator import InputSimulator
from framework.screenshot import ScreenshotCapture
from framework.shell_proxy import ShellProxy
from framework.wait import WaitTimeoutError, wait_for, wait_for_window_count
from framework.window_helper import WindowHelper, drain_all_windows

# Test configuration
# Honour FORGE_E2E_RESULTS_DIR so the docker runner can pin diagnostics to the
# bind-mounted artifact dir; otherwise default to a stable path next to this
# file so local runs do not depend on pytest's working directory.
E2E_RESULTS_DIR = Path(
    os.environ.get("FORGE_E2E_RESULTS_DIR") or (Path(__file__).resolve().parent / "e2e-results")
)
SCREENSHOT_DIR = E2E_RESULTS_DIR / "screenshots"


def pytest_addoption(parser):
    """Register the --dispatch-mode CLI option for InputSimulator.

    Controls whether high-level input_sim methods (toggle_float, toggle_layout,
    focus_*, swap_*, move_*, split_*) route via D-Bus invoke_forge_action
    ("dbus") or via Clutter VirtualInputDevice synthetic keypress
    ("keybinding"). Default "dbus" sidesteps the super+c contamination
    documented in forge-3xz; the "keybinding" mode is intended for a dedicated
    CI lane that preserves end-to-end keybinding coverage.
    """
    parser.addoption(
        "--dispatch-mode",
        default="dbus",
        choices=["dbus", "keybinding"],
        help="How InputSimulator routes high-level forge actions.",
    )


def pytest_configure(config):
    """Configure pytest."""
    E2E_RESULTS_DIR.mkdir(exist_ok=True)
    SCREENSHOT_DIR.mkdir(exist_ok=True)


@pytest.fixture(autouse=True)
def _recording_overlay(request, shell_proxy):
    """Burn the current test name into the screencast overlay (forge-eyu).

    Active only on the recording lane (FORGE_E2E_RECORD=1); a no-op otherwise so
    normal lanes pay zero extra D-Bus eval cost. input_simulator appends the
    firing forge action beneath this label as actions fire.
    """
    if os.environ.get("FORGE_E2E_RECORD") != "1":
        yield
        return
    try:
        shell_proxy.set_recording_overlay(request.node.name)
    except Exception:
        pass  # never fail a test over the diagnostic overlay
    yield


@pytest.fixture(autouse=True)
def _check_shell_alive(shell_proxy):
    """Abort test session immediately if gnome-shell has crashed.

    Uses a lightweight D-Bus eval to detect both process death and D-Bus
    connection loss, which is more reliable than pgrep in containers.
    """
    try:
        shell_proxy.eval("1")
    except Exception:
        pytest.exit("gnome-shell is unreachable — aborting test session", returncode=1)


def pytest_runtest_makereport(item, call):
    """Capture screenshot on test failure (but not on skips)."""
    if (
        call.when == "call"
        and call.excinfo is not None
        and not call.excinfo.errisinstance(pytest.skip.Exception)
    ):
        try:
            screenshot = ScreenshotCapture(str(SCREENSHOT_DIR))
            screenshot.capture_on_failure(item.name, call.excinfo.value)
        except Exception:
            pass  # Don't fail test due to screenshot issues


@pytest.fixture(scope="session")
def display() -> Optional[str]:
    """Get the DISPLAY environment variable."""
    return os.environ.get("DISPLAY")


@pytest.fixture(scope="session")
def shell_proxy() -> Generator[ShellProxy, None, None]:
    """Provide a connected ShellProxy instance."""
    # Get the D-Bus session bus address from environment
    bus_address = os.environ.get("DBUS_SESSION_BUS_ADDRESS")
    if not bus_address:
        # Try to construct it from XDG_RUNTIME_DIR
        xdg_runtime = os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000")
        bus_address = f"unix:path={xdg_runtime}/bus"
        os.environ["DBUS_SESSION_BUS_ADDRESS"] = bus_address

    proxy = ShellProxy()

    def try_connect():
        proxy.connect()
        proxy.get_windows()  # Verify connection works
        return True

    wait_for(
        try_connect,
        timeout=Timeout.SHELL,
        interval=1.0,
        message="Could not connect to GNOME Shell",
    )

    yield proxy
    proxy.disconnect()


@pytest.fixture(scope="session", autouse=True)
def check_forge_ready(shell_proxy):
    """Check if Forge extension is ready (non-blocking)."""
    js = """
    (function() {
        try {
            const ext = Main.extensionManager.lookup('forge@jmmaranan.com');
            return ext && ext.stateObj ? 'ready' : 'not_ready';
        } catch(e) { return 'error'; }
    })();
    """
    try:
        result = shell_proxy.eval(js)
        if result != "ready":
            warnings.warn(f"Forge extension may not be ready at session start: {result}")
    except Exception as e:
        warnings.warn(f"Could not check Forge status: {e}")


@pytest.fixture(scope="session", autouse=True)
def _windows_json_safety_net(shell_proxy, check_forge_ready):
    """Session backstop: restore windows.json to its session-start state on teardown.

    Per-test cleanup (test_config_reload's finally; test_float_class_toggle's
    _strip_editor_float) is skipped if a test errors before its teardown registers,
    leaking a probe or class-wide-float override into ~/.config/forge for the rest
    of the session — and, on a local run, permanently. Snapshot windows.json once
    and restore it at session end so no test's override outlives the session,
    regardless of per-test outcome (forge-1wp). This is a safety net, NOT a
    substitute for per-test isolation. Best-effort: it never raises.
    """
    win_json = None
    try:
        config_dir = shell_proxy.get_config_dir()
        if config_dir:
            win_json = os.path.join(config_dir, "config", "windows.json")
    except Exception as e:
        warnings.warn(f"windows.json safety-net could not resolve config dir: {e}")

    existed = bool(win_json and os.path.exists(win_json))
    original = None
    if existed:
        try:
            with open(win_json, encoding="utf-8") as f:
                original = f.read()
        except Exception as e:
            warnings.warn(f"windows.json safety-net could not snapshot: {e}")

    yield

    if not win_json:
        return
    try:
        if existed and original is not None:
            with open(win_json, "w", encoding="utf-8") as f:
                f.write(original)
        elif not existed and os.path.exists(win_json):
            os.remove(win_json)
        shell_proxy.invoke_forge_action({"name": "ConfigReload"})
    except Exception as e:
        warnings.warn(f"windows.json safety-net restore failed: {e}")


@pytest.fixture(scope="session", autouse=True)
def enable_forge_debug_logging(shell_proxy, check_forge_ready):
    """Enable forge debug logging for the E2E session.

    Toggles the GSettings logging-enabled / log-level keys so forge's
    Logger.debug() output reaches gnome-shell.log. run-tests.sh greps
    that into forge-trace.log alongside the full log. Requires the
    extension to be built with production=false (make debug after make
    build) — otherwise Logger.debug is hard-disabled at compile time.
    """
    js = """
    (function() {
        try {
            const ext = Main.extensionManager.lookup('forge@jmmaranan.com');
            const settings = ext && ext.stateObj && ext.stateObj.settings;
            if (!settings) return 'no_settings';
            settings.set_boolean('logging-enabled', true);
            settings.set_uint('log-level', 5);  // DEBUG
            return 'enabled';
        } catch(e) { return 'error: ' + e.message; }
    })();
    """
    try:
        result = shell_proxy.eval(js)
        if result != "enabled":
            warnings.warn(f"Could not enable forge debug logging: {result}")
    except Exception as e:
        warnings.warn(f"Could not enable forge debug logging: {e}")


@pytest.fixture(scope="session", autouse=True)
def _warm_text_editor(shell_proxy, check_forge_ready):
    """Front-load the gnome-text-editor GApplication launch race into session setup.

    The first `gnome-text-editor --new-window` of a session can hit the ~25s
    GApplication.register() / portal race on Mutter 50 headless Wayland (see
    forge-0gj). Doing one real launch+close here — through the exact same
    `_launch_window` path the tests use (same env, GTK_USE_PORTAL=0) — warms the
    primary so the first actual test launches against an already-serving primary
    instead of being the one that absorbs the race.

    Best-effort: this never raises. A session-scoped autouse fixture that raised
    would error *every* test (a worse cascade than the single early ERROR we're
    fixing). On failure we warn loudly and sweep the workspace clean; the per-test
    `_launch_window` retries+sweep (below) still protect each test independently.
    This runs identically on every lane — it is not gated on Fedora/Mutter version.
    """
    try:
        _launch_window(DEFAULT_TEST_APP, shell_proxy)
    except Exception as e:
        warnings.warn(f"gnome-text-editor warmup launch failed: {e}")
    finally:
        # Always leave a clean workspace for the first test, regardless of whether
        # the warmup window appeared (a late/zombie window must not leak).
        _close_all_windows(shell_proxy)

    # The session runs with num-workspaces=2 / dynamic-workspaces=false, so
    # workspace state is real. Make sure the warmup didn't leave us off ws 0.
    try:
        if shell_proxy.get_active_workspace_index() != 0:
            shell_proxy.eval(
                "(function(){"
                "global.workspace_manager.get_workspace_by_index(0)"
                ".activate(global.get_current_time()); return 'ok';})();"
            )
    except Exception as e:
        warnings.warn(f"Could not restore active workspace to 0 after warmup: {e}")


@pytest.fixture(scope="session")
def dispatch_mode(request) -> str:
    """The --dispatch-mode option as a session-scoped fixture value."""
    return request.config.getoption("--dispatch-mode")


@pytest.fixture(scope="session")
def input_sim(display, shell_proxy, dispatch_mode) -> InputSimulator:
    """Provide an InputSimulator instance.

    Uses Clutter virtual input (via shell_proxy) in Wayland headless mode
    where xdotool cannot trigger compositor keybindings. Uses xdotool in
    X11 mode where it's proven stable.
    """
    is_wayland = os.environ.get("WAYLAND_DISPLAY") and not os.environ.get("DISPLAY")
    if is_wayland:
        return InputSimulator(display=display, shell_proxy=shell_proxy, dispatch_mode=dispatch_mode)
    return InputSimulator(display=display, idle_proxy=shell_proxy, dispatch_mode=dispatch_mode)


@pytest.fixture(scope="session")
def window_helper(shell_proxy) -> WindowHelper:
    """Provide a WindowHelper instance."""
    return WindowHelper(shell_proxy)


@pytest.fixture(scope="session")
def screenshot(display) -> ScreenshotCapture:
    """Provide a ScreenshotCapture instance."""
    return ScreenshotCapture(str(SCREENSHOT_DIR), display=display)


@pytest.fixture(scope="session")
def forge_settings() -> Generator[ForgeSettings, None, None]:
    """Provide connected ForgeSettings instance."""
    # Try with the extension's schema directory first (Docker container path)
    schema_dir = os.path.join(
        os.path.expanduser("~"),
        ".local/share/gnome-shell/extensions",
        FORGE_UUID,
        "schemas",
    )

    settings = None
    if os.path.isdir(schema_dir):
        settings = ForgeSettings(schema_dir=schema_dir)
        try:
            settings.connect()
        except Exception:
            settings = None

    if settings is None:
        settings = ForgeSettings()
        try:
            settings.connect()
        except Exception as e:
            pytest.skip(f"Could not connect to Forge settings: {e}")

    yield settings
    settings.disconnect()


@pytest.fixture
def clean_workspace(shell_proxy, input_sim) -> Generator[None, None, None]:
    """Ensure a clean workspace for testing."""
    _close_all_windows(shell_proxy)
    yield
    _close_all_windows(shell_proxy)
    # Warp the pointer to a neutral spot between tests. An xdotool drag
    # (test_drag_drop_tiling) leaves the pointer stranded at the drop location;
    # the NEXT test's first focused-window op (swap/move/close-refocus) then
    # intermittently lands focus on the wrong window or on none (forge-4b6: the
    # op's geometry succeeds, only focus is wrong; a pointer MOVE clears it, a
    # button release alone does not). Destination is VERSION-CONDITIONAL and
    # EMPIRICAL — each lane's hazard sits at the other lane's safe spot. Both the
    # destinations and the mechanism notes below come from the forge-4b6 sweep:
    #   * X11 (F39-F42): park at the CORNER (40,40), NOT the interior. The flake
    #     rate RISES the deeper the pointer sits in the tiled windows (F39
    #     test_window_swap x8: corner 0/8, center/seam 960,540 ~4/8, mid-pane
    #     700,350 8/8) — it is NOT a divider/seam effect (that theory was
    #     falsified; the interior is the WORST case). The session is click-to-
    #     focus, so this is not Mutter's focus_default_window path; the likely
    #     mechanism is the X11 RevertTo=PointerRoot fallback when Forge's post-op
    #     window.focus() races a still-moving window, making focus follow the
    #     pointer — a corner lands that fallback on a stable window. (Using
    #     get_current_time_roundtrip() on those focus() calls only halves the
    #     flake; see the forge-4b6 follow-up + .scratch EXP-B patch.)
    #   * Wayland (F43/F44, GNOME 49/50): park at CENTER, NOT a corner. A
    #     corner-parked pointer destabilizes the headless session — gnome-shell
    #     dies and goes D-Bus-unreachable ~3/4 of full-suite runs (suite truncates
    #     ~54 tests in), while CENTER is stable (matrix 18/18). This is NOT the
    #     activities hot-corner (disabled) and NOT an Xwayland broken pipe (no
    #     Xwayland is involved) — the prior comment's mechanism was wrong; the
    #     death is silent in gnome-shell.log (one repro logged a Wayland
    #     "Connection reset by peer"). Exact cause unpinned — forge-4b6 follow-up.
    # (Same is_wayland test the input_sim fixture uses.) Best-effort: never fail.
    is_wayland = os.environ.get("WAYLAND_DISPLAY") and not os.environ.get("DISPLAY")
    target = (960, 540) if is_wayland else (40, 40)
    try:
        input_sim.move_mouse(*target)
    except Exception as e:
        warnings.warn(f"pointer reset in teardown failed: {e}")


def _close_all_windows(shell_proxy: ShellProxy) -> None:
    """Close all windows on EVERY workspace one-by-one via D-Bus.

    Thin wrapper over the shared drain (framework.window_helper.drain_all_windows,
    also used by the fuzz engine's _reset_workspace) — see its docstring for the
    one-by-one pacing and gnome-text-editor bus-poisoning rationale. Sweeping all
    workspaces (not just the active one) is load-bearing: the fuzz session's
    switch_ws chaos strands windows on other workspaces, and leftovers used to
    survive this teardown for the rest of the suite (forge-4b6).
    """
    drain_all_windows(shell_proxy)


def _log_window_shortfall(shell_proxy: ShellProxy, n: int, note: str) -> None:
    """Append a fixture window-count mismatch event to fixture-recovery.log.

    Recurrence evidence for the forge-my4w launch-race family. Fetches the live
    window list itself (guarded — the shell may be the thing that broke) and
    probes NameHasOwner for org.gnome.TextEditor. With the primary unit under
    Restart=always this log fires >=5s after any vanish, so the primary has
    normally re-registered by probe time: true is the expected reading either
    way, while false means the systemd restart loop itself is dead (unit
    failed) — a distinct, worse failure. NameHasOwner is answered by
    dbus-daemon itself and can never D-Bus-activate the editor, so the
    bus-poisoning invariant (_close_all_windows) holds. Best-effort: never
    raises.
    """
    try:
        try:
            observed = repr(shell_proxy.get_windows())
        except Exception as e:
            observed = f"<get_windows failed: {e}>"
        try:
            probe = subprocess.run(
                [
                    "gdbus",
                    "call",
                    "--session",
                    "--dest",
                    "org.freedesktop.DBus",
                    "--object-path",
                    "/org/freedesktop/DBus",
                    "--method",
                    "org.freedesktop.DBus.NameHasOwner",
                    "org.gnome.TextEditor",
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            primary = (probe.stdout or probe.stderr).strip()
        except Exception as e:
            primary = f"<probe failed: {e}>"
        log_path = E2E_RESULTS_DIR / "fixture-recovery.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a") as f:
            f.write(f"--- {note} @ {time.time():.3f} ---\n")
            f.write(f"expected={n} observed={observed}\n")
            f.write(f"NameHasOwner(org.gnome.TextEditor)={primary}\n\n")
    except Exception:
        pass


@pytest.fixture
def test_window(shell_proxy, clean_workspace) -> Generator[dict, None, None]:
    """Launch a single test window."""
    window = _launch_window(DEFAULT_TEST_APP, shell_proxy)
    # Structural settle (forge-zsk): _launch_window already polled for the window
    # to appear with a valid size; this brief pause lets the tiling layout
    # animation settle before the test reads geometry. Left as a fixed delay —
    # polling it would couple the generic fixture to per-test layout assertions.
    # The two/three/four_windows fixtures below repeat this pattern.
    time.sleep(Timing.WINDOW_SETTLE)
    yield window


def _launch_windows(shell_proxy: ShellProxy, n: int) -> tuple:
    """Launch n test windows up-front, settling each (forge-zsk).

    Shared by the two/three/four_windows fixtures so the launch+settle loop lives
    in one place; workflow tests that want N windows up-front reuse it too.

    After the loop, verify the exact NET count (forge-my4w): each _launch_window
    call only proves ITS window appeared (`> initial_count`), so an earlier
    window vanishing mid-loop — the gnome-text-editor primary dying while a
    later activation is in flight (forge-4wl family) — yields a "successful"
    fixture with n-1 windows. On mismatch, do one full reset-and-relaunch round
    (idempotent: no separate surplus/shortfall modes) before raising.
    """

    def _launch_loop() -> list:
        windows = []
        for _ in range(n):
            windows.append(_launch_window(DEFAULT_TEST_APP, shell_proxy))
            time.sleep(Timing.WINDOW_SETTLE)
        return windows

    for attempt in range(2):
        windows = _launch_loop()
        try:
            # Windows are already settled, so the healthy path matches on the
            # first poll and this adds no wall-clock time.
            wait_for_window_count(shell_proxy, n, timeout=Timeout.DEFAULT)
        except WaitTimeoutError:
            if attempt:
                _log_window_shortfall(shell_proxy, n, "recovery FAILED")
                raise
            _log_window_shortfall(shell_proxy, n, "count mismatch after launch loop; recovering")
            _close_all_windows(shell_proxy)
            continue
        if attempt:
            _log_window_shortfall(shell_proxy, n, "recovery succeeded")
        return tuple(windows)


@pytest.fixture
def two_windows(shell_proxy, clean_workspace) -> Generator[tuple, None, None]:
    """Launch two test windows."""
    yield _launch_windows(shell_proxy, 2)


@pytest.fixture
def three_windows(shell_proxy, clean_workspace) -> Generator[tuple, None, None]:
    """Launch three test windows."""
    yield _launch_windows(shell_proxy, 3)


@pytest.fixture
def four_windows(shell_proxy, clean_workspace) -> Generator[tuple, None, None]:
    """Launch four test windows."""
    yield _launch_windows(shell_proxy, 4)


@pytest.fixture
def launch_window(shell_proxy, clean_workspace):
    """Return a callable that launches a test window mid-test.

    Unlike the two/three/four_windows fixtures (which launch up-front), this lets
    a test open windows AFTER changing state — needed for settings like
    auto-split that only act on newly-tracked windows. clean_workspace handles
    teardown, so launched windows are closed with the rest.
    """

    def _launch(app: str = DEFAULT_TEST_APP) -> dict:
        window = _launch_window(app, shell_proxy)
        time.sleep(Timing.WINDOW_SETTLE)
        return window

    return _launch


@pytest.fixture
def restore_settings(forge_settings) -> Generator:
    """Yield forge_settings and restore all changes after test."""
    yield forge_settings
    forge_settings.restore_all()
    # Structural settle (forge-zsk): GSettings writes propagate to the extension
    # asynchronously via the GSettings 'changed' signal; there is no queryable
    # post-condition to poll on for "all overrides reverted", so this stays a
    # fixed delay.
    time.sleep(Timing.SETTINGS_SETTLE)


def _launch_window(app: str, shell_proxy: ShellProxy, app_args: list = None) -> dict:
    """Launch an application window and wait for it to appear.

    On Mutter 50 headless Wayland the first few launches in a fresh session
    can fail because gnome-text-editor's GApplication.register() hangs ~25s
    on portal probes ("Failed to register: Timeout was reached") before the
    portal is warmed up. We retry on timeout, killing the stuck subprocess
    so it doesn't leak a half-registered process that fights subsequent
    activations.
    """
    if app_args is None:
        # Palette apps (fuzzer Angle 2) carry their own launch args — notably zenity needs a
        # mode arg or it exits. Non-palette callers keep the historical editor/empty default.
        spec = APP_PALETTE.get(app)
        if spec is not None:
            app_args = spec["args"]
        else:
            app_args = DEFAULT_TEST_APP_ARGS if app == DEFAULT_TEST_APP else []

    # Ensure environment variables are passed to the subprocess
    env = os.environ.copy()
    # For Wayland mode, WAYLAND_DISPLAY should be set by set-env.sh;
    # only fall back to DISPLAY for X11 mode
    if "WAYLAND_DISPLAY" not in env and "DISPLAY" not in env:
        env["DISPLAY"] = ":99"
    # Make sure D-Bus session is set
    if "DBUS_SESSION_BUS_ADDRESS" not in env:
        xdg_runtime = env.get("XDG_RUNTIME_DIR", "/run/user/1000")
        env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={xdg_runtime}/bus"
    # Bypass xdg-desktop-portal where possible (Gtk4 mostly ignores this, but
    # it suppresses Gtk3 portal probes if any test app pulls Gtk3 in).
    env.setdefault("GTK_USE_PORTAL", "0")

    cmd = [app] + app_args
    # Capture subprocess stderr to disk so launch failures can be diagnosed.
    # Append mode: a single rolling log per test session is sufficient.
    stderr_log = E2E_RESULTS_DIR / "subprocess-stderr.log"
    stderr_log.parent.mkdir(parents=True, exist_ok=True)

    def _attempt(attempt: int) -> dict:
        try:
            current = shell_proxy.get_windows()
            initial_count = len(current) if isinstance(current, list) else 0
        except Exception:
            initial_count = 0

        stderr_fp = stderr_log.open("a")
        stderr_fp.write(f"--- {app} {app_args} attempt={attempt} @ {time.time():.3f} ---\n")
        stderr_fp.flush()
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=stderr_fp,
            env=env,
        )

        def find_new_window():
            windows = shell_proxy.get_windows()
            if isinstance(windows, list) and len(windows) > initial_count:
                for w in windows:
                    wm_class = w.get("wmClass", "").lower()
                    if app.split("-")[0] in wm_class:
                        return w
                return windows[-1] if windows else None
            return None

        def has_valid_size(w):
            if w is None:
                return False
            rect = w.get("rect", {})
            return rect.get("width", 0) > 0 and rect.get("height", 0) > 0

        try:
            return wait_for(
                find_new_window,
                predicate=has_valid_size,
                timeout=Timing.WINDOW_LAUNCH,
                interval=Timing.POLL_INTERVAL_WINDOW,
                message=f"Window for '{app}' did not appear",
            )
        except WaitTimeoutError:
            # Kill the hung subprocess so it doesn't claim the bus name later
            # and starve subsequent activations.
            if proc.poll() is None:
                try:
                    proc.terminate()
                    try:
                        proc.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=1)
                except (OSError, ProcessLookupError):
                    pass
            raise
        finally:
            stderr_fp.close()

    max_attempts = 3
    last_exc = None
    for attempt in range(1, max_attempts + 1):
        try:
            return _attempt(attempt)
        except WaitTimeoutError as e:
            last_exc = e
            if attempt == max_attempts:
                break
            # Brief settle gap before retry so a half-started portal/primary
            # has a moment to either finish or be cleared.
            time.sleep(1)

    # All attempts failed. Capture diagnostics so the artifact carries the
    # decisive evidence (probe result at the moment of failure).
    try:
        final_windows = shell_proxy.get_windows()
    except Exception as e:
        final_windows = f"<eval failed: {e}>"
    diag_path = E2E_RESULTS_DIR / "launch-failures.log"
    diag_path.parent.mkdir(parents=True, exist_ok=True)
    with diag_path.open("a") as f:
        f.write(f"--- {app} {app_args} (after {max_attempts} attempts) @ {time.time():.3f} ---\n")
        f.write(f"final_windows={final_windows!r}\n\n")

    # Sweep the workspace to 0 windows before raising so a window that arrived
    # late from a slow activation can't leak into the next test's baseline and
    # cascade as a "did not fill" failure (forge-0gj). clean_workspace already
    # guarantees "0 windows expected" entering each test, so sweep-to-0 (not to a
    # captured baseline, which could itself contain the zombie) is the correct
    # target. _close_all_windows closes via window.delete() and never pokes the
    # gnome-text-editor primary, preserving the bus-poisoning invariant above.
    _close_all_windows(shell_proxy)

    raise last_exc


def pytest_collection_modifyitems(config, items):
    """Add markers based on test names, then order the workflow lane first.

    Workflow tests are tagged by file — matching the '/test_workflow_' path
    segment in item.nodeid (which carries the path, unlike item.name) so only the
    test_workflow_*.py files are swept in, not an atomic test that merely contains
    the word elsewhere. The lane is then selectable with '-m workflow' / excluded
    with '-m "not workflow"'. After marking, a stable sort hoists workflow-marked
    items to the front so the cheap smoke lane runs before the slower atomic
    launches; Timsort preserves intra-lane order, and session/autouse fixtures are
    order-invariant.
    """
    for item in items:
        name = item.name.lower()
        if "/test_workflow_" in item.nodeid:
            item.add_marker(pytest.mark.workflow)
        if "focus" in name:
            item.add_marker(pytest.mark.focus)
        if "layout" in name or "stacked" in name or "tabbed" in name:
            item.add_marker(pytest.mark.layout)
        if "float" in name:
            item.add_marker(pytest.mark.float)
        if "resize" in name:
            item.add_marker(pytest.mark.resize)
        if "drag" in name:
            item.add_marker(pytest.mark.drag)
        if "dialog" in name:
            item.add_marker(pytest.mark.dialog)
        if "workspace" in name:
            item.add_marker(pytest.mark.workspace)
        if "settings" in name or "gap" in name:
            item.add_marker(pytest.mark.settings)
        if "snap" in name:
            item.add_marker(pytest.mark.snap)
        if "rebalance" in name or "close" in name:
            item.add_marker(pytest.mark.rebalance)

    # Run the workflow lane first as a cheap smoke pass (stable sort keeps the
    # collected order within each lane).
    items.sort(key=lambda i: 0 if i.get_closest_marker("workflow") else 1)
