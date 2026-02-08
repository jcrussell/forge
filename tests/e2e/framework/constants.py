"""
Constants for E2E testing.

Centralizes timing values, tolerances, and configuration to avoid
magic numbers scattered throughout the codebase.
"""


class Timing:
    """Timing constants for test synchronization (in seconds)."""

    # Window operations
    WINDOW_SETTLE = 0.5       # Time for window layout to stabilize
    WINDOW_LAUNCH = 10.0      # Max time to wait for window to appear
    WINDOW_CLOSE = 0.3        # Time after closing a window

    # Keyboard/input
    KEY_DELAY_MS = 50         # Delay between key presses (milliseconds)
    KEYBIND_RESPONSE = 0.3    # Time for keybinding to take effect
    KEY_AFTER_PRESS = 0.1     # Brief pause after key press

    # Layout changes
    LAYOUT_CHANGE = 0.5       # Time for layout change to complete
    FOCUS_CHANGE = 0.2        # Time for focus change

    # Polling
    POLL_INTERVAL = 0.1       # Default polling interval
    POLL_INTERVAL_WINDOW = 0.2  # Polling interval for window operations

    # Shell startup
    SHELL_READY_TIMEOUT = 60  # Max time to wait for GNOME Shell
    EXTENSION_INIT = 5        # Time for extensions to initialize
    STABILITY_TIME = 0.5      # Time value must be stable


class Tolerance:
    """Pixel tolerance values for assertions."""

    POSITION = 10             # Window position tolerance
    SIZE = 20                 # Window size tolerance (accounts for default gaps)
    OVERLAP = 100             # Max allowed overlap between tiled windows
    CENTERING = 100           # Tolerance for centered windows
    ALIGNMENT = 20            # Tolerance for window alignment
    FILL_RATIO = 0.85         # Min ratio of workspace filled by windows


class Timeout:
    """Timeout values for various operations (in seconds)."""

    DEFAULT = 5.0             # Default timeout for wait operations
    WINDOW = 10.0             # Timeout for window operations
    SHELL = 60.0              # Timeout for shell startup
    LAYOUT = 5.0              # Timeout for layout operations


class RetryConfig:
    """Retry configuration for flaky operations."""

    MAX_ATTEMPTS = 3
    DELAY = 0.5
    WINDOW_CLOSE_ATTEMPTS = 10


# Forge extension constants
FORGE_UUID = "forge@jmmaranan.com"
# Use --new-window to ensure multiple instances can be launched
DEFAULT_TEST_APP = "gnome-text-editor"
DEFAULT_TEST_APP_ARGS = ["--new-window"]
