"""
Layout Toggle Tests for Forge.

Tests layout toggling between horizontal and vertical splits.
"""

import pytest

from framework.constants import Tolerance


class TestLayoutToggle:
    """Test layout toggle functionality."""

    def test_toggle_hsplit_to_vsplit(self, shell_proxy, input_sim, two_windows):
        """Super+g should toggle between HSPLIT and VSPLIT."""
        # Toggle layout
        input_sim.toggle_layout()

        # Verify windows have been rearranged with valid dimensions
        windows = shell_proxy.get_windows()
        for window in windows:
            rect = window.get("rect", {})
            assert rect.get("width", 0) > 0, "Window should have valid width"
            assert rect.get("height", 0) > 0, "Window should have valid height"

    def test_double_toggle_restores_layout(self, shell_proxy, input_sim, window_helper, two_windows):
        """Toggling twice should restore original layout."""
        window1, window2 = two_windows
        wm_class1 = window1.get("wmClass")

        initial_rect = window_helper.get_window_rect(wm_class1)

        # Toggle twice
        input_sim.toggle_layout()
        input_sim.toggle_layout()

        final_rect = window_helper.get_window_rect(wm_class1)

        # Position should be restored
        assert abs(initial_rect[0] - final_rect[0]) < Tolerance.ALIGNMENT, "X not restored"
        assert abs(initial_rect[1] - final_rect[1]) < Tolerance.ALIGNMENT, "Y not restored"

    def test_split_vertical_explicit(self, shell_proxy, input_sim, two_windows):
        """Super+v should set vertical split mode."""
        input_sim.split_vertical()

        windows = shell_proxy.get_windows()
        sorted_by_y = sorted(windows, key=lambda w: w.get("rect", {}).get("y", 0))

        if len(sorted_by_y) >= 2:
            top = sorted_by_y[0].get("rect", {})
            bottom = sorted_by_y[-1].get("rect", {})

            # In vertical layout, windows have similar width
            width_diff = abs(top.get("width", 0) - bottom.get("width", 0))
            assert width_diff < Tolerance.ALIGNMENT * 2, "Windows should have similar width in VSPLIT"

    def test_split_horizontal_explicit(self, shell_proxy, input_sim, two_windows):
        """Super+z should set horizontal split mode."""
        # First switch to vertical, then to horizontal
        input_sim.split_vertical()
        input_sim.split_horizontal()

        windows = shell_proxy.get_windows()
        sorted_by_x = sorted(windows, key=lambda w: w.get("rect", {}).get("x", 0))

        if len(sorted_by_x) >= 2:
            left = sorted_by_x[0].get("rect", {})
            right = sorted_by_x[-1].get("rect", {})

            # In horizontal layout, windows have similar height
            height_diff = abs(left.get("height", 0) - right.get("height", 0))
            assert height_diff < Tolerance.ALIGNMENT * 2, "Windows should have similar height in HSPLIT"


class TestLayoutWithMultipleWindows:
    """Test layout behavior with multiple windows."""

    def test_layout_toggle_three_windows(self, shell_proxy, input_sim, three_windows):
        """Layout toggle should work with three windows."""
        input_sim.toggle_layout()

        windows = shell_proxy.get_windows()
        assert len(windows) >= 3, f"Expected 3 windows, got {len(windows)}"

        for window in windows:
            rect = window.get("rect", {})
            assert rect.get("width", 0) > 50, "Window too narrow"
            assert rect.get("height", 0) > 50, "Window too short"

    def test_layout_preserves_focus(self, shell_proxy, input_sim, two_windows):
        """Layout toggle should preserve which window is focused."""
        focused_before = shell_proxy.get_focused_window()
        focused_class_before = focused_before.get("wmClass")

        input_sim.toggle_layout()

        focused_after = shell_proxy.get_focused_window()
        focused_class_after = focused_after.get("wmClass")

        assert focused_class_before == focused_class_after, (
            f"Focus changed from {focused_class_before} to {focused_class_after}"
        )
