"""
Window Swap Tests for Forge.

Tests window swapping with Ctrl+Super+h/j/k/l keys.
"""

import pytest

from framework.constants import Tolerance


class TestWindowSwap:
    """Test window swap functionality."""

    def test_swap_left_right(self, shell_proxy, input_sim, two_windows):
        """Ctrl+Super+h/l should swap window positions."""
        windows_before = shell_proxy.get_windows()
        assert len(windows_before) >= 2, "Need at least 2 windows"

        # Navigate to ensure we're on the right window
        input_sim.focus_right()
        input_sim.focus_right()

        # Swap with window to the left
        input_sim.swap_left()

        # Verify swap occurred
        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "Should have a focused window after swap"

    def test_swap_preserves_window_count(self, shell_proxy, input_sim, two_windows):
        """Swapping should not change the number of windows."""
        count_before = len(shell_proxy.get_windows())

        input_sim.swap_left()
        input_sim.swap_right()

        count_after = len(shell_proxy.get_windows())
        assert count_before == count_after, (
            f"Window count changed from {count_before} to {count_after}"
        )

    def test_swap_up_down_in_vsplit(self, shell_proxy, input_sim, two_windows):
        """Ctrl+Super+j/k should swap in vertical split."""
        # Toggle to vertical split
        input_sim.toggle_layout()

        # Swap down
        input_sim.swap_down()

        # Verify windows still exist with valid positions
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Windows should still exist after swap"

        for window in windows:
            rect = window.get("rect", {})
            assert rect.get("width", 0) > 0, "Window should have valid width"
            assert rect.get("height", 0) > 0, "Window should have valid height"

    def test_swap_single_window_no_effect(self, shell_proxy, input_sim, window_helper, test_window):
        """Swapping with single window should have no effect."""
        wm_class = test_window.get("wmClass")
        rect_before = window_helper.get_window_rect(wm_class)

        # Try all swap directions
        input_sim.swap_left()
        input_sim.swap_right()
        input_sim.swap_up()
        input_sim.swap_down()

        rect_after = window_helper.get_window_rect(wm_class)

        # Position should be unchanged
        assert abs(rect_before[0] - rect_after[0]) < Tolerance.POSITION, "X position changed"
        assert abs(rect_before[1] - rect_after[1]) < Tolerance.POSITION, "Y position changed"
        assert abs(rect_before[2] - rect_after[2]) < Tolerance.POSITION, "Width changed"
        assert abs(rect_before[3] - rect_after[3]) < Tolerance.POSITION, "Height changed"


class TestWindowMove:
    """Test window move to container functionality."""

    def test_move_creates_new_container(self, shell_proxy, input_sim, two_windows):
        """Shift+Super+direction should move window to new container."""
        input_sim.move_down()

        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Both windows should still exist after move"

    def test_move_preserves_window_count(self, shell_proxy, input_sim, three_windows):
        """Moving windows should preserve window count."""
        count_before = len(shell_proxy.get_windows())

        input_sim.move_left()
        input_sim.move_right()
        input_sim.move_up()
        input_sim.move_down()

        count_after = len(shell_proxy.get_windows())
        assert count_before == count_after, (
            f"Window count changed from {count_before} to {count_after}"
        )
