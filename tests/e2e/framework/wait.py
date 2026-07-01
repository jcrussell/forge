"""
Wait/Polling Utilities for E2E tests.

Provides functions to wait for conditions with timeout support.
Essential for handling async window operations in GNOME Shell.
"""

import time
from typing import Callable, Optional, TypeVar

from .constants import Timeout, Timing, Tolerance

T = TypeVar("T")


class WaitTimeoutError(Exception):
    """Exception raised when a wait operation times out."""

    pass


def wait_for(
    condition: Callable[[], T],
    timeout: float = Timeout.DEFAULT,
    interval: float = Timing.POLL_INTERVAL,
    message: str = "Condition not met",
    predicate: Optional[Callable[[T], bool]] = None,
) -> T:
    """
    Wait for a condition to be satisfied.

    This is the core wait function. All other wait_for_* functions are
    convenience wrappers around this one.

    Args:
        condition: Callable that returns a value to check.
        timeout: Maximum time to wait in seconds.
        interval: Time between checks in seconds.
        message: Error message if timeout occurs.
        predicate: Optional function to evaluate the condition result.
                  If None, result is checked for truthiness.

    Returns:
        The value returned by condition when predicate is satisfied.

    Raises:
        WaitTimeoutError: If condition is not met within timeout.

    Examples:
        # Wait for truthy value
        wait_for(lambda: shell.get_focused_window())

        # Wait for specific value
        wait_for(lambda: get_count(), predicate=lambda x: x == 5)

        # Wait for window by class
        wait_for(
            lambda: find_window(shell, "gedit"),
            predicate=lambda w: w is not None,
            timeout=Timeout.WINDOW
        )
    """
    check = predicate if predicate else bool
    start = time.time()
    last_value = None
    last_exception = None

    while time.time() - start < timeout:
        try:
            last_value = condition()
            if check(last_value):
                return last_value
        except Exception as e:
            last_exception = e
        time.sleep(interval)

    if last_exception:
        raise WaitTimeoutError(f"{message}: {last_exception}") from last_exception
    raise WaitTimeoutError(f"{message}. Last value: {last_value}")


def wait_for_stable(
    getter: Callable[[], T],
    stability_time: float = Timing.STABILITY_TIME,
    timeout: float = Timeout.DEFAULT,
    interval: float = Timing.POLL_INTERVAL,
) -> T:
    """
    Wait for a value to stabilize (stop changing).

    Useful for waiting for window animations to complete.

    Args:
        getter: Callable that returns a value.
        stability_time: Time the value must remain stable.
        timeout: Maximum total time to wait.
        interval: Time between checks.

    Returns:
        The stable value.

    Raises:
        WaitTimeoutError: If value doesn't stabilize within timeout.
    """
    start = time.time()
    last_value = None
    stable_since = None

    while time.time() - start < timeout:
        try:
            current = getter()
            if current == last_value:
                if stable_since is None:
                    stable_since = time.time()
                elif time.time() - stable_since >= stability_time:
                    return current
            else:
                last_value = current
                stable_since = None
        except Exception:
            stable_since = None
        time.sleep(interval)

    raise WaitTimeoutError("Value did not stabilize")


def retry(
    func: Callable[[], T],
    max_attempts: int = 3,
    delay: float = 0.5,
    exceptions: tuple = (Exception,),
) -> T:
    """
    Retry a function on failure.

    Args:
        func: Function to call.
        max_attempts: Maximum number of attempts.
        delay: Delay between attempts in seconds.
        exceptions: Tuple of exception types to catch.

    Returns:
        Result of successful function call.

    Raises:
        The last exception if all attempts fail.
    """
    last_exception = None

    for attempt in range(max_attempts):
        try:
            return func()
        except exceptions as e:
            last_exception = e
            if attempt < max_attempts - 1:
                time.sleep(delay)

    raise last_exception


# Convenience functions - thin wrappers around wait_for()


def wait_for_window(shell_proxy, wm_class: str, timeout: float = Timeout.WINDOW) -> dict:
    """Wait for a window with specific WM_CLASS to appear."""

    def find():
        windows = shell_proxy.get_windows()
        if isinstance(windows, list):
            for w in windows:
                if w.get("wmClass") == wm_class:
                    return w
        return None

    return wait_for(
        find,
        predicate=lambda w: w is not None,
        timeout=timeout,
        interval=Timing.POLL_INTERVAL_WINDOW,
        message=f"Window '{wm_class}' did not appear",
    )


def wait_for_window_count(shell_proxy, count: int, timeout: float = Timeout.WINDOW) -> list:
    """Wait for a specific number of windows."""
    return wait_for(
        shell_proxy.get_windows,
        predicate=lambda w: isinstance(w, list) and len(w) == count,
        timeout=timeout,
        interval=Timing.POLL_INTERVAL_WINDOW,
        message=f"Expected {count} windows",
    )


def wait_for_focus(shell_proxy, wm_class: str, timeout: float = Timeout.DEFAULT) -> dict:
    """Wait for a specific window to be focused."""

    def get_focus():
        try:
            return shell_proxy.get_focused_window()
        except Exception:
            return {}

    return wait_for(
        get_focus,
        predicate=lambda w: w.get("wmClass") == wm_class,
        timeout=timeout,
        message=f"Window '{wm_class}' did not receive focus",
    )


def wait_for_layout(shell_proxy, expected: str, timeout: float = Timeout.LAYOUT) -> str:
    """Wait for the focused container to have a specific layout."""
    return wait_for(
        shell_proxy.get_container_layout,
        predicate=lambda layout: layout == expected,
        timeout=timeout,
        message=f"Layout did not change to '{expected}'",
    )


def wait_for_window_fill(
    shell_proxy,
    workspace_rect: dict,
    tolerance: int = Tolerance.SIZE,
    timeout: float = Timeout.LAYOUT,
) -> dict:
    """Wait until the single remaining window fills the workspace."""

    def check():
        windows = shell_proxy.get_windows()
        if not isinstance(windows, list) or len(windows) != 1:
            return None
        rect = windows[0].get("rect", {})
        width_ok = abs(rect.get("width", 0) - workspace_rect["width"]) < tolerance
        height_ok = abs(rect.get("height", 0) - workspace_rect["height"]) < tolerance
        if width_ok and height_ok:
            return windows[0]
        return None

    return wait_for(
        check,
        predicate=lambda w: w is not None,
        timeout=timeout,
        interval=Timing.POLL_INTERVAL,
        message=f"Window did not fill workspace ({workspace_rect['width']}x{workspace_rect['height']})",
    )


def wait_for_layout_settled(
    shell_proxy,
    workspace_rect: dict,
    fill_ratio: float = Tolerance.FILL_RATIO,
    timeout: float = Timeout.LAYOUT,
) -> list:
    """Wait until windows fill the expected portion of the workspace."""

    def check():
        windows = shell_proxy.get_windows()
        if not isinstance(windows, list) or len(windows) == 0:
            return None
        total_area = sum(
            w.get("rect", {}).get("width", 0) * w.get("rect", {}).get("height", 0) for w in windows
        )
        ws_area = workspace_rect["width"] * workspace_rect["height"]
        if ws_area > 0 and total_area / ws_area >= fill_ratio:
            return windows
        return None

    return wait_for(
        check,
        predicate=lambda w: w is not None,
        timeout=timeout,
        interval=Timing.POLL_INTERVAL,
        message="Layout did not settle (windows don't fill workspace)",
    )
