"""
Window Helper for E2E tests.

Provides assertion helpers for verifying window positions, sizes,
and layout states in Forge.
"""

from typing import List, Optional, Tuple

from .constants import Tolerance
from .shell_proxy import ShellProxy


class WindowAssertionError(Exception):
    """Exception raised when a window assertion fails."""

    pass


class WindowHelper:
    """
    Helper class for window-related assertions and queries.

    Provides methods to verify window positions, sizes, and
    relative positioning for testing Forge tiling behavior.
    """

    def __init__(self, shell_proxy: ShellProxy):
        """
        Initialize the window helper.

        Args:
            shell_proxy: ShellProxy instance for querying window state.
        """
        self._shell = shell_proxy

    def get_window_by_class(self, wm_class: str) -> Optional[dict]:
        """
        Get window information by WM_CLASS.

        Args:
            wm_class: The WM_CLASS to search for.

        Returns:
            Window dictionary or None if not found.
        """
        windows = self._shell.get_windows()
        if isinstance(windows, list):
            for window in windows:
                if window.get("wmClass") == wm_class:
                    return window
        return None

    def get_focused_window(self) -> dict:
        """
        Get the currently focused window.

        Returns:
            Window dictionary with title, wmClass, rect.

        Raises:
            WindowAssertionError: If no window is focused.
        """
        window = self._shell.get_focused_window()
        if isinstance(window, dict) and "error" in window:
            raise WindowAssertionError(window["error"])
        return window

    def get_workspace_rect(self) -> dict:
        """
        Get the current workspace's usable area.

        Returns:
            Dictionary with x, y, width, height.
        """
        return self._shell.get_workspace_rect()

    # Position assertions

    def assert_window_position(
        self,
        wm_class: str,
        expected_x: int,
        expected_y: int,
        tolerance: int = Tolerance.POSITION,
    ) -> None:
        """
        Assert that a window is at the expected position.

        Args:
            wm_class: Window's WM_CLASS.
            expected_x: Expected X coordinate.
            expected_y: Expected Y coordinate.
            tolerance: Allowed deviation in pixels.

        Raises:
            WindowAssertionError: If position doesn't match.
        """
        window = self.get_window_by_class(wm_class)
        if not window:
            raise WindowAssertionError(f"Window with class '{wm_class}' not found")

        rect = window.get("rect", {})
        actual_x = rect.get("x", 0)
        actual_y = rect.get("y", 0)

        if abs(actual_x - expected_x) > tolerance or abs(actual_y - expected_y) > tolerance:
            raise WindowAssertionError(
                f"Window position mismatch: expected ({expected_x}, {expected_y}), "
                f"got ({actual_x}, {actual_y})"
            )

    def assert_window_size(
        self,
        wm_class: str,
        expected_width: int,
        expected_height: int,
        tolerance: int = Tolerance.POSITION,
    ) -> None:
        """
        Assert that a window has the expected size.

        Args:
            wm_class: Window's WM_CLASS.
            expected_width: Expected width.
            expected_height: Expected height.
            tolerance: Allowed deviation in pixels.

        Raises:
            WindowAssertionError: If size doesn't match.
        """
        window = self.get_window_by_class(wm_class)
        if not window:
            raise WindowAssertionError(f"Window with class '{wm_class}' not found")

        rect = window.get("rect", {})
        actual_width = rect.get("width", 0)
        actual_height = rect.get("height", 0)

        if (
            abs(actual_width - expected_width) > tolerance
            or abs(actual_height - expected_height) > tolerance
        ):
            raise WindowAssertionError(
                f"Window size mismatch: expected ({expected_width}x{expected_height}), "
                f"got ({actual_width}x{actual_height})"
            )

    def assert_window_fills_workspace(
        self,
        wm_class: str,
        position_tolerance: int = Tolerance.POSITION,
        size_tolerance: int = Tolerance.SIZE,
    ) -> None:
        """
        Assert that a window fills the entire workspace.

        Args:
            wm_class: Window's WM_CLASS.
            position_tolerance: Allowed deviation in position (pixels).
            size_tolerance: Allowed deviation in size (pixels, accounts for gaps).

        Raises:
            WindowAssertionError: If window doesn't fill workspace.
        """
        window = self.get_window_by_class(wm_class)
        if not window:
            raise WindowAssertionError(f"Window with class '{wm_class}' not found")

        workspace = self.get_workspace_rect()
        rect = window.get("rect", {})

        # Check position
        if (
            abs(rect.get("x", 0) - workspace.get("x", 0)) > position_tolerance
            or abs(rect.get("y", 0) - workspace.get("y", 0)) > position_tolerance
        ):
            raise WindowAssertionError(
                f"Window not at workspace origin: "
                f"window at ({rect.get('x')}, {rect.get('y')}), "
                f"workspace at ({workspace.get('x')}, {workspace.get('y')})"
            )

        # Check size (allows for gaps around window edges)
        if (
            abs(rect.get("width", 0) - workspace.get("width", 0)) > size_tolerance
            or abs(rect.get("height", 0) - workspace.get("height", 0)) > size_tolerance
        ):
            raise WindowAssertionError(
                f"Window not filling workspace: "
                f"window ({rect.get('width')}x{rect.get('height')}), "
                f"workspace ({workspace.get('width')}x{workspace.get('height')})"
            )

    # Relative position assertions

    def assert_windows_side_by_side(
        self,
        left_wm_class: str,
        right_wm_class: str,
        tolerance: int = Tolerance.POSITION,
    ) -> None:
        """
        Assert that two windows are positioned side by side horizontally.

        Args:
            left_wm_class: WM_CLASS of the left window.
            right_wm_class: WM_CLASS of the right window.
            tolerance: Allowed deviation in pixels.

        Raises:
            WindowAssertionError: If windows aren't side by side.
        """
        left = self.get_window_by_class(left_wm_class)
        right = self.get_window_by_class(right_wm_class)

        if not left:
            raise WindowAssertionError(f"Left window '{left_wm_class}' not found")
        if not right:
            raise WindowAssertionError(f"Right window '{right_wm_class}' not found")

        left_rect = left.get("rect", {})
        right_rect = right.get("rect", {})

        # Right window's x should be near left window's x + width
        expected_right_x = left_rect.get("x", 0) + left_rect.get("width", 0)
        actual_right_x = right_rect.get("x", 0)

        if abs(actual_right_x - expected_right_x) > tolerance:
            raise WindowAssertionError(
                f"Windows not side by side: left ends at x={expected_right_x}, "
                f"right starts at x={actual_right_x}"
            )

        # Windows should have similar y position and height
        if abs(left_rect.get("y", 0) - right_rect.get("y", 0)) > tolerance:
            raise WindowAssertionError(
                f"Windows not aligned vertically: "
                f"left at y={left_rect.get('y')}, right at y={right_rect.get('y')}"
            )

    def assert_windows_stacked_vertically(
        self,
        top_wm_class: str,
        bottom_wm_class: str,
        tolerance: int = Tolerance.POSITION,
    ) -> None:
        """
        Assert that two windows are stacked vertically.

        Args:
            top_wm_class: WM_CLASS of the top window.
            bottom_wm_class: WM_CLASS of the bottom window.
            tolerance: Allowed deviation in pixels.

        Raises:
            WindowAssertionError: If windows aren't stacked.
        """
        top = self.get_window_by_class(top_wm_class)
        bottom = self.get_window_by_class(bottom_wm_class)

        if not top:
            raise WindowAssertionError(f"Top window '{top_wm_class}' not found")
        if not bottom:
            raise WindowAssertionError(f"Bottom window '{bottom_wm_class}' not found")

        top_rect = top.get("rect", {})
        bottom_rect = bottom.get("rect", {})

        # Bottom window's y should be near top window's y + height
        expected_bottom_y = top_rect.get("y", 0) + top_rect.get("height", 0)
        actual_bottom_y = bottom_rect.get("y", 0)

        if abs(actual_bottom_y - expected_bottom_y) > tolerance:
            raise WindowAssertionError(
                f"Windows not stacked: top ends at y={expected_bottom_y}, "
                f"bottom starts at y={actual_bottom_y}"
            )

        # Windows should have similar x position
        if abs(top_rect.get("x", 0) - bottom_rect.get("x", 0)) > tolerance:
            raise WindowAssertionError(
                f"Windows not aligned horizontally: "
                f"top at x={top_rect.get('x')}, bottom at x={bottom_rect.get('x')}"
            )

    def assert_windows_equal_width(
        self,
        wm_class1: str,
        wm_class2: str,
        tolerance: int = Tolerance.POSITION,
    ) -> None:
        """
        Assert that two windows have equal width.

        Args:
            wm_class1: First window's WM_CLASS.
            wm_class2: Second window's WM_CLASS.
            tolerance: Allowed deviation in pixels.
        """
        w1 = self.get_window_by_class(wm_class1)
        w2 = self.get_window_by_class(wm_class2)

        if not w1:
            raise WindowAssertionError(f"Window '{wm_class1}' not found")
        if not w2:
            raise WindowAssertionError(f"Window '{wm_class2}' not found")

        width1 = w1.get("rect", {}).get("width", 0)
        width2 = w2.get("rect", {}).get("width", 0)

        if abs(width1 - width2) > tolerance:
            raise WindowAssertionError(
                f"Windows don't have equal width: {wm_class1}={width1}, {wm_class2}={width2}"
            )

    def assert_windows_equal_height(
        self,
        wm_class1: str,
        wm_class2: str,
        tolerance: int = Tolerance.POSITION,
    ) -> None:
        """
        Assert that two windows have equal height.

        Args:
            wm_class1: First window's WM_CLASS.
            wm_class2: Second window's WM_CLASS.
            tolerance: Allowed deviation in pixels.
        """
        w1 = self.get_window_by_class(wm_class1)
        w2 = self.get_window_by_class(wm_class2)

        if not w1:
            raise WindowAssertionError(f"Window '{wm_class1}' not found")
        if not w2:
            raise WindowAssertionError(f"Window '{wm_class2}' not found")

        height1 = w1.get("rect", {}).get("height", 0)
        height2 = w2.get("rect", {}).get("height", 0)

        if abs(height1 - height2) > tolerance:
            raise WindowAssertionError(
                f"Windows don't have equal height: {wm_class1}={height1}, {wm_class2}={height2}"
            )

    # Layout assertions

    def assert_layout_type(self, expected_layout: str) -> None:
        """
        Assert that the focused window's container has the expected layout.

        Args:
            expected_layout: Expected layout type ('HSPLIT', 'VSPLIT', 'STACKED', 'TABBED').

        Raises:
            WindowAssertionError: If layout doesn't match.
        """
        actual_layout = self._shell.get_container_layout()

        if actual_layout != expected_layout:
            raise WindowAssertionError(
                f"Layout mismatch: expected '{expected_layout}', got '{actual_layout}'"
            )

    def assert_window_floating(self, wm_class: str, should_be_floating: bool = True) -> None:
        """
        Assert that a window is floating or tiled.

        Args:
            wm_class: Window's WM_CLASS.
            should_be_floating: True if window should be floating, False if tiled.

        Raises:
            WindowAssertionError: If float state doesn't match.
        """
        is_floating = self._shell.is_window_floating(wm_class)

        if is_floating != should_be_floating:
            state = "floating" if should_be_floating else "tiled"
            actual = "tiled" if should_be_floating else "floating"
            raise WindowAssertionError(
                f"Window '{wm_class}' should be {state} but is {actual}"
            )

    def assert_window_focused(self, wm_class: str) -> None:
        """
        Assert that a specific window is focused.

        Args:
            wm_class: Expected WM_CLASS of focused window.

        Raises:
            WindowAssertionError: If wrong window is focused.
        """
        focused = self.get_focused_window()
        if focused.get("wmClass") != wm_class:
            raise WindowAssertionError(
                f"Expected '{wm_class}' to be focused, but '{focused.get('wmClass')}' is"
            )

    def get_window_rect(self, wm_class: str) -> Tuple[int, int, int, int]:
        """
        Get window rectangle as tuple.

        Args:
            wm_class: Window's WM_CLASS.

        Returns:
            Tuple of (x, y, width, height).

        Raises:
            WindowAssertionError: If window not found.
        """
        window = self.get_window_by_class(wm_class)
        if not window:
            raise WindowAssertionError(f"Window '{wm_class}' not found")

        rect = window.get("rect", {})
        return (
            rect.get("x", 0),
            rect.get("y", 0),
            rect.get("width", 0),
            rect.get("height", 0),
        )

    @staticmethod
    def calculate_overlap(rect1: Tuple[int, int, int, int], rect2: Tuple[int, int, int, int]) -> int:
        """
        Calculate overlapping pixel area between two rectangles.

        Args:
            rect1: First rectangle as (x, y, width, height).
            rect2: Second rectangle as (x, y, width, height).

        Returns:
            Overlapping area in pixels.
        """
        x_overlap = max(0, min(rect1[0] + rect1[2], rect2[0] + rect2[2]) - max(rect1[0], rect2[0]))
        y_overlap = max(0, min(rect1[1] + rect1[3], rect2[1] + rect2[3]) - max(rect1[1], rect2[1]))
        return x_overlap * y_overlap

    def assert_windows_no_overlap(
        self,
        wm_class1: str,
        wm_class2: str,
        max_overlap: int = Tolerance.OVERLAP,
    ) -> None:
        """
        Assert that two windows don't significantly overlap.

        Args:
            wm_class1: First window's WM_CLASS.
            wm_class2: Second window's WM_CLASS.
            max_overlap: Maximum allowed overlap in pixels.

        Raises:
            WindowAssertionError: If windows overlap too much.
        """
        rect1 = self.get_window_rect(wm_class1)
        rect2 = self.get_window_rect(wm_class2)
        overlap = self.calculate_overlap(rect1, rect2)

        if overlap > max_overlap:
            raise WindowAssertionError(
                f"Windows overlap by {overlap} pixels (max allowed: {max_overlap})"
            )

    # Sorting and measurement helpers

    def get_windows_sorted_by_position(self, axis: str = "x") -> List[dict]:
        """
        Get all windows sorted by position along an axis.

        Args:
            axis: Sort axis - 'x' for horizontal, 'y' for vertical.

        Returns:
            List of window dicts sorted by the specified coordinate.
        """
        windows = self._shell.get_windows()
        if not isinstance(windows, list):
            return []
        return sorted(windows, key=lambda w: w.get("rect", {}).get(axis, 0))

    def assert_windows_fill_workspace(
        self, tolerance: float = Tolerance.FILL_RATIO
    ) -> None:
        """
        Assert that tiled windows together fill most of the workspace.

        Args:
            tolerance: Minimum fill ratio (0.0 to 1.0).

        Raises:
            WindowAssertionError: If fill ratio is below tolerance.
        """
        workspace = self._shell.get_workspace_rect()
        workspace_area = workspace["width"] * workspace["height"]

        windows = self._shell.get_windows()
        if not isinstance(windows, list) or not windows:
            raise WindowAssertionError("No windows found")

        total_area = sum(
            w.get("rect", {}).get("width", 0) * w.get("rect", {}).get("height", 0)
            for w in windows
        )

        fill_ratio = total_area / workspace_area if workspace_area > 0 else 0
        if fill_ratio < tolerance:
            raise WindowAssertionError(
                f"Windows fill only {fill_ratio*100:.1f}% of workspace "
                f"(minimum: {tolerance*100:.1f}%)"
            )

    def measure_gap_between(self) -> int:
        """
        Measure the pixel gap between two side-by-side windows.

        Returns:
            Gap in pixels between the right edge of the left window
            and the left edge of the right window.

        Raises:
            WindowAssertionError: If fewer than 2 windows found.
        """
        sorted_wins = self.get_windows_sorted_by_position("x")
        if len(sorted_wins) < 2:
            raise WindowAssertionError("Need at least 2 windows to measure gap")

        left = sorted_wins[0].get("rect", {})
        right = sorted_wins[1].get("rect", {})
        return right.get("x", 0) - (left.get("x", 0) + left.get("width", 0))
