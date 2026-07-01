# Forge E2E Testing Framework
"""
Framework modules for end-to-end testing of the Forge GNOME Shell extension.
"""

from .constants import FORGE_UUID, RetryConfig, Timeout, Timing, Tolerance
from .gsettings import ForgeSettings
from .input_simulator import InputSimulator
from .screenshot import ScreenshotCapture
from .shell_proxy import ShellProxy
from .wait import WaitTimeoutError, retry, wait_for, wait_for_stable, wait_for_window
from .window_helper import WindowHelper

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
