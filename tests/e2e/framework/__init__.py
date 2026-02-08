# Forge E2E Testing Framework
"""
Framework modules for end-to-end testing of the Forge GNOME Shell extension.
"""

from .constants import Timing, Tolerance, Timeout, RetryConfig, FORGE_UUID
from .shell_proxy import ShellProxy
from .input_simulator import InputSimulator
from .window_helper import WindowHelper
from .screenshot import ScreenshotCapture
from .wait import wait_for, wait_for_window, wait_for_stable, retry, WaitTimeoutError
from .gsettings import ForgeSettings

__all__ = [
    # Constants
    "Timing",
    "Tolerance",
    "Timeout",
    "RetryConfig",
    "FORGE_UUID",
    # Core classes
    "ShellProxy",
    "InputSimulator",
    "WindowHelper",
    "ScreenshotCapture",
    "ForgeSettings",
    # Wait utilities
    "wait_for",
    "wait_for_window",
    "wait_for_stable",
    "retry",
    "WaitTimeoutError",
]
