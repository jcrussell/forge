"""
Focus Navigation Tests for Forge.

Tests vim-style focus navigation with Super+h/j/k/l keys.
"""

import pytest

from framework.constants import Timing


class TestFocusNavigation:
    """Test focus navigation with keyboard shortcuts."""

    def test_focus_left_right(self, shell_proxy, input_sim, two_windows):
        """Super+h and Super+l should move focus left and right."""
        window1, window2 = two_windows

        # Navigate left
        input_sim.focus_left()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "A window should be focused after Super+h"

        # Navigate right
        input_sim.focus_right()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "A window should be focused after Super+l"

    def test_focus_wraps_or_stays(self, shell_proxy, input_sim, test_window):
        """Focus navigation at edge should wrap or stay in place."""
        wm_class = test_window.get("wmClass")

        # With single window, focus should stay on same window
        input_sim.focus_left()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass") == wm_class, (
            "Focus should stay on only window when navigating left"
        )

        input_sim.focus_right()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass") == wm_class, (
            "Focus should stay on only window when navigating right"
        )

    def test_focus_up_down_in_vsplit(self, shell_proxy, input_sim, two_windows):
        """Super+j and Super+k should navigate in vertical split."""
        # Toggle to vertical split
        input_sim.toggle_layout()

        # Navigate up/down
        input_sim.focus_down()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "A window should be focused after Super+j"

        input_sim.focus_up()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "A window should be focused after Super+k"

    def test_focus_cycles_through_windows(self, shell_proxy, input_sim, three_windows):
        """Focus should cycle through all windows."""
        focused_classes = set()

        # Navigate multiple times to hit all windows
        for _ in range(6):
            focused = shell_proxy.get_focused_window()
            if focused.get("wmClass"):
                focused_classes.add(focused.get("wmClass"))
            input_sim.focus_right()

        for _ in range(6):
            focused = shell_proxy.get_focused_window()
            if focused.get("wmClass"):
                focused_classes.add(focused.get("wmClass"))
            input_sim.focus_left()

        assert len(focused_classes) >= 2, (
            f"Should focus multiple windows, only focused: {focused_classes}"
        )


class TestFocusAfterClose:
    """Test focus behavior after closing windows."""

    def test_focus_moves_after_close(self, shell_proxy, input_sim, two_windows):
        """Focus should move to another window when focused window is closed."""
        # Close the focused window
        input_sim.close_active_window()

        # Should have at least one window remaining
        windows = shell_proxy.get_windows()
        assert len(windows) >= 1, "Should have at least one window remaining"

        # Remaining window should have focus
        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass") or focused.get("title"), (
            "Remaining window should receive focus"
        )
