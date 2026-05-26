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
    Timing,
    Timeout,
    RetryConfig,
    DEFAULT_TEST_APP,
    DEFAULT_TEST_APP_ARGS,
    FORGE_UUID,
)
from framework.shell_proxy import ShellProxy, ShellProxyError
from framework.input_simulator import InputSimulator
from framework.window_helper import WindowHelper
from framework.screenshot import ScreenshotCapture
from framework.gsettings import ForgeSettings
from framework.wait import wait_for, WaitTimeoutError


# Test configuration
# Honour FORGE_E2E_RESULTS_DIR so the docker runner can pin diagnostics to the
# bind-mounted artifact dir; otherwise default to a stable path next to this
# file so local runs do not depend on pytest's working directory.
E2E_RESULTS_DIR = Path(
    os.environ.get("FORGE_E2E_RESULTS_DIR")
    or (Path(__file__).resolve().parent / "e2e-results")
)
SCREENSHOT_DIR = E2E_RESULTS_DIR / "screenshots"


def pytest_configure(config):
    """Configure pytest."""
    E2E_RESULTS_DIR.mkdir(exist_ok=True)
    SCREENSHOT_DIR.mkdir(exist_ok=True)


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
    """Capture screenshot on test failure."""
    if call.when == "call" and call.excinfo is not None:
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
            warnings.warn(
                f"Forge extension may not be ready at session start: {result}"
            )
    except Exception as e:
        warnings.warn(f"Could not check Forge status: {e}")


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


@pytest.fixture(scope="session")
def input_sim(display, shell_proxy) -> InputSimulator:
    """Provide an InputSimulator instance.

    Uses Clutter virtual input (via shell_proxy) in Wayland headless mode
    where xdotool cannot trigger compositor keybindings. Uses xdotool in
    X11 mode where it's proven stable.
    """
    is_wayland = os.environ.get("WAYLAND_DISPLAY") and not os.environ.get("DISPLAY")
    if is_wayland:
        return InputSimulator(display=display, shell_proxy=shell_proxy)
    return InputSimulator(display=display, idle_proxy=shell_proxy)


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
def clean_workspace(shell_proxy) -> Generator[None, None, None]:
    """Ensure a clean workspace for testing."""
    _close_all_windows(shell_proxy)
    yield
    _close_all_windows(shell_proxy)


def _close_all_windows(shell_proxy: ShellProxy) -> None:
    """Close all windows on the current workspace one-by-one via D-Bus.

    Closing windows individually avoids overwhelming the rendering pipeline
    under Xvfb, which can saturate the main loop and cause gnome-shell to
    lose its D-Bus service channel name.

    We do NOT proactively Quit or SIGTERM the gnome-text-editor GApplication
    primary. On Mutter 50 headless Wayland the .service file
    (`Exec=gnome-text-editor --gapplication-service`) means any gdbus call to
    `org.gnome.TextEditor` D-Bus-activates a fresh service-mode instance just
    to receive the message — which itself races registration and hangs with
    "Failed to register: Timeout was reached", blocking subsequent
    `--new-window` launches indefinitely. Letting the primary stay alive and
    serve `--new-window` activations is the only path that doesn't poison
    the session bus.
    """
    for _ in range(RetryConfig.WINDOW_CLOSE_ATTEMPTS):
        try:
            windows = shell_proxy.get_windows()
            if not windows:
                break
            shell_proxy.close_one_window()
            time.sleep(Timing.WINDOW_CLOSE)
        except Exception:
            break
    time.sleep(Timing.WINDOW_SETTLE)


@pytest.fixture
def test_window(shell_proxy, clean_workspace) -> Generator[dict, None, None]:
    """Launch a single test window."""
    window = _launch_window(DEFAULT_TEST_APP, shell_proxy)
    time.sleep(Timing.WINDOW_SETTLE)
    yield window


@pytest.fixture
def two_windows(shell_proxy, clean_workspace) -> Generator[tuple, None, None]:
    """Launch two test windows."""
    window1 = _launch_window(DEFAULT_TEST_APP, shell_proxy)
    time.sleep(Timing.WINDOW_SETTLE)
    window2 = _launch_window(DEFAULT_TEST_APP, shell_proxy)
    time.sleep(Timing.WINDOW_SETTLE)
    yield (window1, window2)


@pytest.fixture
def three_windows(shell_proxy, clean_workspace) -> Generator[tuple, None, None]:
    """Launch three test windows."""
    window1 = _launch_window(DEFAULT_TEST_APP, shell_proxy)
    time.sleep(Timing.WINDOW_SETTLE)
    window2 = _launch_window(DEFAULT_TEST_APP, shell_proxy)
    time.sleep(Timing.WINDOW_SETTLE)
    window3 = _launch_window(DEFAULT_TEST_APP, shell_proxy)
    time.sleep(Timing.WINDOW_SETTLE)
    yield (window1, window2, window3)


@pytest.fixture
def four_windows(shell_proxy, clean_workspace) -> Generator[tuple, None, None]:
    """Launch four test windows."""
    windows = []
    for _ in range(4):
        w = _launch_window(DEFAULT_TEST_APP, shell_proxy)
        time.sleep(Timing.WINDOW_SETTLE)
        windows.append(w)
    yield tuple(windows)


@pytest.fixture
def restore_settings(forge_settings) -> Generator:
    """Yield forge_settings and restore all changes after test."""
    yield forge_settings
    forge_settings.restore_all()
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
    raise last_exc


def pytest_collection_modifyitems(config, items):
    """Add markers based on test names."""
    for item in items:
        name = item.name.lower()
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
