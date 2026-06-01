"""
Input Simulator for E2E tests.

Supports two backends for keyboard and mouse input:
  - Clutter (via ShellProxy): Uses Clutter's VirtualInputDevice API through
    D-Bus Shell.Eval. Works in both X11 and Wayland modes. Preferred backend.
  - xdotool (legacy): X11-only, used when no ShellProxy is provided.

The Clutter backend is required for Wayland headless mode (GNOME 49+/Fedora 43+)
because xdotool cannot trigger compositor-level keybindings through XWayland.
"""

import os
import subprocess
import time
from typing import TYPE_CHECKING, Optional

from .constants import Timing

if TYPE_CHECKING:
    from .shell_proxy import ShellProxy


# Mirror of DEFAULT_FLOAT_LAYOUT in lib/extension/keybindings.js:31 — the kwargs
# the keybinding callback passes to extWm.command({name: "FloatToggle", ...}).
# Kept in sync so the dbus dispatch path produces the same window geometry as
# the keybinding path.
DEFAULT_FLOAT_LAYOUT = {
    "mode": "float",
    "x": "center",
    "y": "center",
    "width": 0.65,
    "height": 0.75,
}


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
        "workspace_tile_toggle": ("shift+super", "w"),
        # Move window between workspaces
        "move_window_next_ws": ("shift+super", "Page_Down"),
        "move_window_prev_ws": ("shift+super", "Page_Up"),
        # Resize
        "resize_left_increase": ("ctrl+super", "y"),
        "resize_left_decrease": ("ctrl+shift+super", "o"),
        "resize_right_increase": ("ctrl+super", "o"),
        "resize_right_decrease": ("ctrl+shift+super", "y"),
        "resize_bottom_increase": ("ctrl+super", "u"),
        "resize_bottom_decrease": ("ctrl+shift+super", "i"),
        "resize_top_increase": ("ctrl+super", "i"),
        "resize_top_decrease": ("ctrl+shift+super", "u"),
        "reset_sizes": ("super", "equal"),
        # Snap layouts
        "snap_center": ("ctrl+alt", "c"),
        "snap_one_third_left": ("ctrl+alt", "d"),
        "snap_two_third_left": ("ctrl+alt", "e"),
        "snap_one_third_right": ("ctrl+alt", "g"),
        "snap_two_third_right": ("ctrl+alt", "t"),
    }

    def __init__(
        self,
        display: Optional[str] = None,
        key_delay: int = Timing.KEY_DELAY_MS,
        shell_proxy: Optional["ShellProxy"] = None,
        idle_proxy: Optional["ShellProxy"] = None,
        dispatch_mode: str = "dbus",
    ):
        """
        Initialize the input simulator.

        Args:
            display: X11 DISPLAY value (e.g., ':99'). If None, uses environment.
            key_delay: Delay between key presses in milliseconds.
            shell_proxy: Optional ShellProxy for Clutter-based input (required
                for Wayland mode, also works in X11 mode).
            idle_proxy: Optional ShellProxy used only for wait_for_idle() calls
                after heavy layout operations. Use this in X11 mode where
                xdotool handles input but idle waits are still needed.
            dispatch_mode: How methods with a forge action equivalent route
                their request:
                  "dbus" (default): invoke_forge_action via Shell.Eval.
                  "keybinding": simulate_key_combo via Clutter VirtualInputDevice.
                Methods without a forge action equivalent (close_active_window,
                type_text, workspace_*, etc.) always use the synthetic key path
                regardless of dispatch_mode.
        """
        self._display = display
        self._key_delay = key_delay
        self._shell_proxy = shell_proxy
        self._idle_proxy = idle_proxy or shell_proxy
        if dispatch_mode not in ("dbus", "keybinding"):
            raise InputSimulatorError(
                f"Unknown dispatch_mode: {dispatch_mode!r} (expected 'dbus' or 'keybinding')"
            )
        self.dispatch_mode = dispatch_mode
        # Screencast overlay (forge-eyu): when recording, label each fired action
        # beneath the test name. Computed once so normal lanes do no extra work.
        self._overlay_enabled = os.environ.get("FORGE_E2E_RECORD") == "1"
        if not shell_proxy:
            self._verify_xdotool()

    def _dispatch(
        self,
        action_name: Optional[str],
        key_combo: str,
        **action_kwargs,
    ) -> None:
        """
        Dispatch a forge action either via D-Bus invoke_forge_action or via
        synthetic keypress, depending on self.dispatch_mode.

        If action_name is None, or no proxy is available, falls through to the
        synthetic key path unconditionally.

        Args:
            action_name: Name of the forge action (e.g., "FloatToggle"), or
                None if no forge-action equivalent exists for the binding.
            key_combo: Synthetic key combination (e.g., "super+c") used in
                "keybinding" mode or as fallback.
            **action_kwargs: Additional parameters for invoke_forge_action.
        """
        if self._overlay_enabled and action_name and self._idle_proxy is not None:
            try:
                self._idle_proxy.set_recording_action(action_name)
            except Exception:
                pass  # never fail a test over the diagnostic overlay

        if (
            self.dispatch_mode == "dbus"
            and action_name is not None
            and self._idle_proxy is not None
        ):
            self._idle_proxy.invoke_forge_action({"name": action_name, **action_kwargs})
            time.sleep(Timing.KEY_AFTER_PRESS)
        else:
            self.key(key_combo)

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

        Uses Clutter VirtualInputDevice when any shell proxy is available
        (both Wayland and X11 modes) to avoid triggering the GNOME overview
        when Super key combos are sent. Falls back to xdotool only when no
        proxy is available at all.

        Args:
            key_spec: Key specification (e.g., 'super+h', 'ctrl+shift+a').
        """
        proxy = self._shell_proxy or self._idle_proxy
        if proxy:
            proxy.simulate_key_combo(key_spec)
        else:
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
        if self._shell_proxy:
            for char in text:
                self._shell_proxy.simulate_key_combo(char)
                time.sleep(delay / 1000.0)
        else:
            self._run_xdotool("type", "--delay", str(delay), text)

    # Forge-specific keybinding methods

    def focus_left(self) -> None:
        """Focus window to the left (Super+h / Focus direction=Left)."""
        self._dispatch("Focus", "super+h", direction="Left")

    def focus_down(self) -> None:
        """Focus window below (Super+j / Focus direction=Down)."""
        self._dispatch("Focus", "super+j", direction="Down")

    def focus_up(self) -> None:
        """Focus window above (Super+k / Focus direction=Up)."""
        self._dispatch("Focus", "super+k", direction="Up")

    def focus_right(self) -> None:
        """Focus window to the right (Super+l / Focus direction=Right)."""
        self._dispatch("Focus", "super+l", direction="Right")

    def swap_left(self) -> None:
        """Swap window left (Ctrl+Super+h / Swap direction=Left)."""
        self._dispatch("Swap", "ctrl+super+h", direction="Left")

    def swap_down(self) -> None:
        """Swap window down (Ctrl+Super+j / Swap direction=Down)."""
        self._dispatch("Swap", "ctrl+super+j", direction="Down")

    def swap_up(self) -> None:
        """Swap window up (Ctrl+Super+k / Swap direction=Up)."""
        self._dispatch("Swap", "ctrl+super+k", direction="Up")

    def swap_right(self) -> None:
        """Swap window right (Ctrl+Super+l / Swap direction=Right)."""
        self._dispatch("Swap", "ctrl+super+l", direction="Right")

    def move_left(self) -> None:
        """Move window left (Shift+Super+h / Move direction=Left)."""
        self._dispatch("Move", "shift+super+h", direction="Left")

    def move_down(self) -> None:
        """Move window down (Shift+Super+j / Move direction=Down)."""
        self._dispatch("Move", "shift+super+j", direction="Down")

    def move_up(self) -> None:
        """Move window up (Shift+Super+k / Move direction=Up)."""
        self._dispatch("Move", "shift+super+k", direction="Up")

    def move_right(self) -> None:
        """Move window right (Shift+Super+l / Move direction=Right)."""
        self._dispatch("Move", "shift+super+l", direction="Right")

    def toggle_float(self) -> None:
        """Toggle floating mode for focused window (Super+c / FloatToggle).

        Default dispatch_mode='dbus' avoids the synthetic super+c contamination
        documented in forge-3xz root cause #2 (Mutter mutates focused-window
        state when super+c arrives through Clutter VirtualInputDevice, even
        before forge's keybinding handler runs).
        """
        self._dispatch("FloatToggle", "super+c", **DEFAULT_FLOAT_LAYOUT)

    def toggle_layout(self) -> None:
        """Toggle between horizontal and vertical split (Super+g / LayoutToggle)."""
        self._dispatch("LayoutToggle", "super+g")

    def split_vertical(self) -> None:
        """Set vertical split mode (Super+v / Split orientation=vertical)."""
        self._dispatch("Split", "super+v", orientation="vertical")

    def split_horizontal(self) -> None:
        """Set horizontal split mode (Super+z / Split orientation=horizontal)."""
        self._dispatch("Split", "super+z", orientation="horizontal")

    def toggle_stacked(self) -> None:
        """Toggle stacked layout (Shift+Super+s / LayoutStackedToggle)."""
        self._dispatch("LayoutStackedToggle", "shift+super+s")
        time.sleep(Timing.STACKED_LAYOUT_CHANGE)
        if self._idle_proxy:
            self._idle_proxy.wait_for_idle()

    def toggle_tabbed(self) -> None:
        """Toggle tabbed layout (Shift+Super+t / LayoutTabbedToggle)."""
        self._dispatch("LayoutTabbedToggle", "shift+super+t")
        time.sleep(Timing.STACKED_LAYOUT_CHANGE)
        if self._idle_proxy:
            self._idle_proxy.wait_for_idle()

    def workspace_prev(self) -> None:
        """Press Super+Page_Up to go to previous workspace."""
        self.key("super+Page_Up")

    def workspace_next(self) -> None:
        """Press Super+Page_Down to go to next workspace."""
        self.key("super+Page_Down")

    def workspace_tile_toggle(self) -> None:
        """Press Shift+Super+w to toggle workspace tiling."""
        self.key("shift+super+w")

    def move_window_next_ws(self) -> None:
        """Press Shift+Super+Page_Down to move window to next workspace."""
        self.key("shift+super+Page_Down")

    def move_window_prev_ws(self) -> None:
        """Press Shift+Super+Page_Up to move window to previous workspace."""
        self.key("shift+super+Page_Up")

    # Resize methods

    def resize_left_increase(self) -> None:
        """Press Ctrl+Super+y to increase left resize."""
        self.key("ctrl+super+y")

    def resize_left_decrease(self) -> None:
        """Press Ctrl+Shift+Super+o to decrease left resize."""
        self.key("ctrl+shift+super+o")

    def resize_right_increase(self) -> None:
        """Press Ctrl+Super+o to increase right resize."""
        self.key("ctrl+super+o")

    def resize_right_decrease(self) -> None:
        """Press Ctrl+Shift+Super+y to decrease right resize."""
        self.key("ctrl+shift+super+y")

    def resize_bottom_increase(self) -> None:
        """Press Ctrl+Super+u to increase bottom resize."""
        self.key("ctrl+super+u")

    def resize_bottom_decrease(self) -> None:
        """Press Ctrl+Shift+Super+i to decrease bottom resize."""
        self.key("ctrl+shift+super+i")

    def resize_top_increase(self) -> None:
        """Press Ctrl+Super+i to increase top resize."""
        self.key("ctrl+super+i")

    def resize_top_decrease(self) -> None:
        """Press Ctrl+Shift+Super+u to decrease top resize."""
        self.key("ctrl+shift+super+u")

    def reset_sizes(self) -> None:
        """Press Super+= to reset window sizes to equal."""
        self.key("super+equal")

    # Snap layout methods

    def snap_center(self) -> None:
        """Press Ctrl+Alt+c to snap window to center."""
        self.key("ctrl+alt+c")

    def snap_one_third_left(self) -> None:
        """Press Ctrl+Alt+d to snap window to left third."""
        self.key("ctrl+alt+d")

    def snap_two_third_left(self) -> None:
        """Press Ctrl+Alt+e to snap window to left two-thirds."""
        self.key("ctrl+alt+e")

    def snap_one_third_right(self) -> None:
        """Press Ctrl+Alt+g to snap window to right third."""
        self.key("ctrl+alt+g")

    def snap_two_third_right(self) -> None:
        """Press Ctrl+Alt+t to snap window to right two-thirds."""
        self.key("ctrl+alt+t")

    # Mouse operations

    def click(self, x: int, y: int, button: int = 1) -> None:
        """
        Click at specific coordinates.

        Args:
            x: X coordinate.
            y: Y coordinate.
            button: Mouse button (1=left, 2=middle, 3=right).
        """
        if self._shell_proxy:
            self._shell_proxy.simulate_click(x, y, button)
        else:
            self._run_xdotool("mousemove", str(x), str(y))
            self._run_xdotool("click", str(button))

    def move_mouse(self, x: int, y: int) -> None:
        """
        Move mouse to specific coordinates.

        Args:
            x: X coordinate.
            y: Y coordinate.
        """
        if self._shell_proxy:
            self._shell_proxy.simulate_mouse_move(x, y)
        else:
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
        if self._shell_proxy:
            self._shell_proxy.simulate_mouse_move(start_x, start_y)
            self._shell_proxy.simulate_mouse_button(1, True)
            time.sleep(0.1)
            self._shell_proxy.simulate_mouse_move(end_x, end_y)
            time.sleep(0.1)
            self._shell_proxy.simulate_mouse_button(1, False)
        else:
            self._run_xdotool("mousemove", str(start_x), str(start_y))
            self._run_xdotool("mousedown", "1")
            time.sleep(0.1)
            self._run_xdotool("mousemove", str(end_x), str(end_y))
            time.sleep(0.1)
            self._run_xdotool("mouseup", "1")

    def drag_window(
        self,
        start_x: int,
        start_y: int,
        end_x: int,
        end_y: int,
        steps: int = 10,
        step_delay: float = 0.05,
    ) -> None:
        """
        Drag from start to end in incremental steps.

        Unlike drag(), this moves in small increments to trigger
        Mutter's continuous grab-op-move callbacks, which is required
        for drop zone detection during drag-and-drop tiling.

        Args:
            start_x: Starting X coordinate.
            start_y: Starting Y coordinate.
            end_x: Ending X coordinate.
            end_y: Ending Y coordinate.
            steps: Number of intermediate steps.
            step_delay: Delay between steps in seconds.
        """
        if self._shell_proxy:
            self._shell_proxy.simulate_mouse_move(start_x, start_y)
            time.sleep(0.1)
            self._shell_proxy.simulate_mouse_button(1, True)
            time.sleep(0.1)
            for i in range(1, steps + 1):
                interp = i / steps
                cur_x = int(start_x + (end_x - start_x) * interp)
                cur_y = int(start_y + (end_y - start_y) * interp)
                self._shell_proxy.simulate_mouse_move(cur_x, cur_y)
                time.sleep(step_delay)
            time.sleep(0.1)
            self._shell_proxy.simulate_mouse_button(1, False)
        else:
            self._run_xdotool("mousemove", str(start_x), str(start_y))
            time.sleep(0.1)
            self._run_xdotool("mousedown", "1")
            time.sleep(0.1)
            for i in range(1, steps + 1):
                interp = i / steps
                cur_x = int(start_x + (end_x - start_x) * interp)
                cur_y = int(start_y + (end_y - start_y) * interp)
                self._run_xdotool("mousemove", str(cur_x), str(cur_y))
                time.sleep(step_delay)
            time.sleep(0.1)
            self._run_xdotool("mouseup", "1")

    # Window operations

    def focus_window(self, window_id: str) -> None:
        """
        Focus a specific window by ID.

        Args:
            window_id: X11 window ID (xdotool) or ignored (Clutter mode
                uses ShellProxy.ensure_focus instead).
        """
        if self._shell_proxy:
            self._shell_proxy.ensure_focus()
        else:
            self._run_xdotool("windowfocus", window_id)
        time.sleep(Timing.KEY_AFTER_PRESS)

    def activate_window(self, window_id: str) -> None:
        """
        Activate (focus and raise) a specific window by ID.

        Args:
            window_id: X11 window ID (xdotool mode only).
        """
        if self._shell_proxy:
            self._shell_proxy.ensure_focus()
        else:
            self._run_xdotool("windowactivate", window_id)
        time.sleep(Timing.KEY_AFTER_PRESS)

    def get_active_window(self) -> str:
        """
        Get the currently active window ID.

        Returns:
            X11 window ID as string, or 'clutter' in Clutter mode.
        """
        if self._shell_proxy:
            return "clutter"
        return self._run_xdotool("getactivewindow")

    def search_window(self, name: str) -> list:
        """
        Search for windows by name.

        Args:
            name: Window name pattern.

        Returns:
            List of matching window IDs.
        """
        if self._shell_proxy:
            return []
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
