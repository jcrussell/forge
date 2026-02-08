"""
Input Simulator for E2E tests.

Uses xdotool to simulate keyboard and mouse input for testing
Forge keybindings and window interactions.
"""

import subprocess
import time
from typing import Optional

from .constants import Timing


class InputSimulatorError(Exception):
    """Exception raised when input simulation fails."""

    pass


class InputSimulator:
    """
    Simulates keyboard and mouse input using xdotool.

    Supports all Forge keybindings including focus, swap, move,
    float toggle, and layout operations.
    """

    # Modifier key mappings for xdotool
    MODIFIERS = {
        "Super": "super",
        "Ctrl": "ctrl",
        "Shift": "shift",
        "Alt": "alt",
    }

    # Forge keybinding definitions (action -> keys)
    FORGE_BINDINGS = {
        # Focus navigation
        "focus_left": ("super", "h"),
        "focus_down": ("super", "j"),
        "focus_up": ("super", "k"),
        "focus_right": ("super", "l"),
        # Window swap
        "swap_left": ("ctrl+super", "h"),
        "swap_down": ("ctrl+super", "j"),
        "swap_up": ("ctrl+super", "k"),
        "swap_right": ("ctrl+super", "l"),
        # Window move to container
        "move_left": ("shift+super", "h"),
        "move_down": ("shift+super", "j"),
        "move_up": ("shift+super", "k"),
        "move_right": ("shift+super", "l"),
        # Float toggle
        "float_toggle": ("super", "c"),
        # Layout toggles
        "layout_toggle": ("super", "g"),
        "split_vertical": ("super", "v"),
        "split_horizontal": ("super", "z"),
        # Stacked/Tabbed
        "stacked_toggle": ("shift+super", "s"),
        "tabbed_toggle": ("shift+super", "t"),
        # Workspace operations
        "workspace_prev": ("super", "Page_Up"),
        "workspace_next": ("super", "Page_Down"),
    }

    def __init__(
        self, display: Optional[str] = None, key_delay: int = Timing.KEY_DELAY_MS
    ):
        """
        Initialize the input simulator.

        Args:
            display: X11 DISPLAY value (e.g., ':99'). If None, uses environment.
            key_delay: Delay between key presses in milliseconds.
        """
        self._display = display
        self._key_delay = key_delay
        self._verify_xdotool()

    def _verify_xdotool(self) -> None:
        """Verify xdotool is available."""
        try:
            subprocess.run(
                ["xdotool", "--version"],
                capture_output=True,
                check=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            raise InputSimulatorError(
                "xdotool not found. Please install xdotool."
            ) from e

    def _run_xdotool(self, *args: str) -> str:
        """
        Run xdotool with the given arguments.

        Args:
            *args: Arguments to pass to xdotool.

        Returns:
            stdout from xdotool.

        Raises:
            InputSimulatorError: If xdotool fails.
        """
        env = None
        if self._display:
            import os

            env = os.environ.copy()
            env["DISPLAY"] = self._display

        try:
            result = subprocess.run(
                ["xdotool"] + list(args),
                capture_output=True,
                text=True,
                check=True,
                env=env,
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError as e:
            raise InputSimulatorError(f"xdotool failed: {e.stderr}") from e

    def key(self, key_spec: str) -> None:
        """
        Press and release a key or key combination.

        Args:
            key_spec: Key specification (e.g., 'super+h', 'ctrl+shift+a').
        """
        self._run_xdotool("key", "--delay", str(self._key_delay), key_spec)
        time.sleep(Timing.KEY_AFTER_PRESS)

    def key_down(self, key: str) -> None:
        """Press a key down without releasing."""
        self._run_xdotool("keydown", key)

    def key_up(self, key: str) -> None:
        """Release a key."""
        self._run_xdotool("keyup", key)

    def type_text(self, text: str, delay: int = 12) -> None:
        """
        Type text character by character.

        Args:
            text: Text to type.
            delay: Delay between characters in milliseconds.
        """
        self._run_xdotool("type", "--delay", str(delay), text)

    # Forge-specific keybinding methods

    def focus_left(self) -> None:
        """Press Super+h to focus window to the left."""
        self.key("super+h")

    def focus_down(self) -> None:
        """Press Super+j to focus window below."""
        self.key("super+j")

    def focus_up(self) -> None:
        """Press Super+k to focus window above."""
        self.key("super+k")

    def focus_right(self) -> None:
        """Press Super+l to focus window to the right."""
        self.key("super+l")

    def swap_left(self) -> None:
        """Press Ctrl+Super+h to swap window left."""
        self.key("ctrl+super+h")

    def swap_down(self) -> None:
        """Press Ctrl+Super+j to swap window down."""
        self.key("ctrl+super+j")

    def swap_up(self) -> None:
        """Press Ctrl+Super+k to swap window up."""
        self.key("ctrl+super+k")

    def swap_right(self) -> None:
        """Press Ctrl+Super+l to swap window right."""
        self.key("ctrl+super+l")

    def move_left(self) -> None:
        """Press Shift+Super+h to move window to container on left."""
        self.key("shift+super+h")

    def move_down(self) -> None:
        """Press Shift+Super+j to move window to container below."""
        self.key("shift+super+j")

    def move_up(self) -> None:
        """Press Shift+Super+k to move window to container above."""
        self.key("shift+super+k")

    def move_right(self) -> None:
        """Press Shift+Super+l to move window to container on right."""
        self.key("shift+super+l")

    def toggle_float(self) -> None:
        """Press Super+c to toggle floating mode for focused window."""
        self.key("super+c")

    def toggle_layout(self) -> None:
        """Press Super+g to toggle between horizontal and vertical split."""
        self.key("super+g")

    def split_vertical(self) -> None:
        """Press Super+v to set vertical split mode."""
        self.key("super+v")

    def split_horizontal(self) -> None:
        """Press Super+z to set horizontal split mode."""
        self.key("super+z")

    def toggle_stacked(self) -> None:
        """Press Shift+Super+s to toggle stacked layout."""
        self.key("shift+super+s")

    def toggle_tabbed(self) -> None:
        """Press Shift+Super+t to toggle tabbed layout."""
        self.key("shift+super+t")

    def workspace_prev(self) -> None:
        """Press Super+Page_Up to go to previous workspace."""
        self.key("super+Page_Up")

    def workspace_next(self) -> None:
        """Press Super+Page_Down to go to next workspace."""
        self.key("super+Page_Down")

    # Mouse operations

    def click(self, x: int, y: int, button: int = 1) -> None:
        """
        Click at specific coordinates.

        Args:
            x: X coordinate.
            y: Y coordinate.
            button: Mouse button (1=left, 2=middle, 3=right).
        """
        self._run_xdotool("mousemove", str(x), str(y))
        self._run_xdotool("click", str(button))

    def move_mouse(self, x: int, y: int) -> None:
        """
        Move mouse to specific coordinates.

        Args:
            x: X coordinate.
            y: Y coordinate.
        """
        self._run_xdotool("mousemove", str(x), str(y))

    def drag(self, start_x: int, start_y: int, end_x: int, end_y: int) -> None:
        """
        Drag from start to end coordinates.

        Args:
            start_x: Starting X coordinate.
            start_y: Starting Y coordinate.
            end_x: Ending X coordinate.
            end_y: Ending Y coordinate.
        """
        self._run_xdotool("mousemove", str(start_x), str(start_y))
        self._run_xdotool("mousedown", "1")
        time.sleep(0.1)
        self._run_xdotool("mousemove", str(end_x), str(end_y))
        time.sleep(0.1)
        self._run_xdotool("mouseup", "1")

    # Window operations

    def focus_window(self, window_id: str) -> None:
        """
        Focus a specific window by ID.

        Args:
            window_id: X11 window ID.
        """
        self._run_xdotool("windowfocus", window_id)
        time.sleep(Timing.KEY_AFTER_PRESS)

    def activate_window(self, window_id: str) -> None:
        """
        Activate (focus and raise) a specific window by ID.

        Args:
            window_id: X11 window ID.
        """
        self._run_xdotool("windowactivate", window_id)
        time.sleep(Timing.KEY_AFTER_PRESS)

    def get_active_window(self) -> str:
        """
        Get the currently active window ID.

        Returns:
            X11 window ID as string.
        """
        return self._run_xdotool("getactivewindow")

    def search_window(self, name: str) -> list:
        """
        Search for windows by name.

        Args:
            name: Window name pattern.

        Returns:
            List of matching window IDs.
        """
        try:
            output = self._run_xdotool("search", "--name", name)
            return output.split("\n") if output else []
        except InputSimulatorError:
            return []

    def close_active_window(self) -> None:
        """Close the currently active window."""
        self.key("alt+F4")
        time.sleep(Timing.WINDOW_CLOSE)

    def execute_forge_action(self, action_name: str) -> None:
        """
        Execute a Forge action by name.

        Args:
            action_name: One of the FORGE_BINDINGS keys.

        Raises:
            InputSimulatorError: If action is not recognized.
        """
        if action_name not in self.FORGE_BINDINGS:
            raise InputSimulatorError(f"Unknown Forge action: {action_name}")

        modifiers, key = self.FORGE_BINDINGS[action_name]
        key_spec = f"{modifiers}+{key}" if modifiers else key
        self.key(key_spec)
