"""
Pytest fixtures for Forge E2E tests.

Provides fixtures for shell proxy, input simulator, window helper,
and other testing utilities.
"""

import os
import subprocess
import time
from pathlib import Path
from typing import Generator, Optional

import pytest

from framework.constants import (
    Timing,
    Timeout,
    RetryConfig,
    DEFAULT_TEST_APP,
    DEFAULT_TEST_APP_ARGS,
)
from framework.shell_proxy import ShellProxy, ShellProxyError
from framework.input_simulator import InputSimulator
from framework.window_helper import WindowHelper
from framework.screenshot import ScreenshotCapture
from framework.gsettings import ForgeSettings
from framework.wait import wait_for, WaitTimeoutError


# Test configuration
E2E_RESULTS_DIR = Path("e2e-results")
SCREENSHOT_DIR = E2E_RESULTS_DIR / "screenshots"


def pytest_configure(config):
    """Configure pytest."""
    E2E_RESULTS_DIR.mkdir(exist_ok=True)
    SCREENSHOT_DIR.mkdir(exist_ok=True)


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


@pytest.fixture(scope="session")
def input_sim(display) -> InputSimulator:
    """Provide an InputSimulator instance."""
    return InputSimulator(display=display)


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
    """Close all windows on the current workspace via D-Bus."""
    for _ in range(RetryConfig.WINDOW_CLOSE_ATTEMPTS):
        try:
            windows = shell_proxy.get_windows()
            if not windows:
                break
            shell_proxy.close_all_windows()
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


def _launch_window(app: str, shell_proxy: ShellProxy, app_args: list = None) -> dict:
    """Launch an application window and wait for it to appear."""
    if app_args is None:
        app_args = DEFAULT_TEST_APP_ARGS if app == DEFAULT_TEST_APP else []

    try:
        current = shell_proxy.get_windows()
        initial_count = len(current) if isinstance(current, list) else 0
    except Exception:
        initial_count = 0

    # Ensure environment variables are passed to the subprocess
    env = os.environ.copy()
    # Make sure DISPLAY is set
    if "DISPLAY" not in env:
        env["DISPLAY"] = ":99"
    # Make sure D-Bus session is set
    if "DBUS_SESSION_BUS_ADDRESS" not in env:
        xdg_runtime = env.get("XDG_RUNTIME_DIR", "/run/user/1000")
        env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={xdg_runtime}/bus"

    cmd = [app] + app_args
    subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )

    def find_new_window():
        windows = shell_proxy.get_windows()
        if isinstance(windows, list) and len(windows) > initial_count:
            # Return the newest window (likely the one we just launched)
            for w in windows:
                wm_class = w.get("wmClass", "").lower()
                if app.split("-")[0] in wm_class:
                    return w
            # Fallback: return any new window
            return windows[-1] if windows else None
        return None

    return wait_for(
        find_new_window,
        predicate=lambda w: w is not None,
        timeout=Timing.WINDOW_LAUNCH,
        interval=Timing.POLL_INTERVAL_WINDOW,
        message=f"Window for '{app}' did not appear",
    )


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
