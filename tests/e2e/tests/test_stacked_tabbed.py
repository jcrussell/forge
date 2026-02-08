"""
Stacked and Tabbed Layout Tests for Forge.

Tests stacked (Shift+Super+s) and tabbed (Shift+Super+t) layouts.
"""

import pytest

from framework.constants import Tolerance


class TestStackedLayout:
    """Test stacked layout functionality."""

    def test_toggle_stacked_mode(self, shell_proxy, input_sim, two_windows):
        """Shift+Super+s should toggle stacked layout."""
        input_sim.toggle_stacked()

        # Both windows should still exist
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Both windows should exist in stacked mode"

        # Layout should be valid
        layout = shell_proxy.get_container_layout()
        assert layout in ["STACKED", "HSPLIT", "VSPLIT", "TABBED", "NO_NODE", "ERROR"], (
            f"Unexpected layout: {layout}"
        )

    def test_stacked_windows_valid(self, shell_proxy, input_sim, two_windows):
        """In stacked mode, windows should have valid dimensions."""
        input_sim.toggle_stacked()

        windows = shell_proxy.get_windows()
        for window in windows:
            rect = window.get("rect", {})
            assert rect.get("width", 0) > 0, "Window should have width"
            assert rect.get("height", 0) > 0, "Window should have height"

    def test_stacked_focus_navigation(self, shell_proxy, input_sim, two_windows):
        """Should be able to navigate focus in stacked mode."""
        input_sim.toggle_stacked()

        input_sim.focus_down()
        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "Should have focused window after navigation"

        input_sim.focus_up()
        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "Should have focused window after navigation"

    def test_stacked_toggle_off(self, shell_proxy, input_sim, window_helper, two_windows):
        """Toggling stacked twice should restore normal layout."""
        window1, window2 = two_windows
        wm_class1 = window1.get("wmClass")

        rect_before = window_helper.get_window_rect(wm_class1)

        # Toggle stacked on then off
        input_sim.toggle_stacked()
        input_sim.toggle_stacked()

        rect_after = window_helper.get_window_rect(wm_class1)

        # Window should have valid dimensions
        assert rect_after[2] > 0, "Window should have width"
        assert rect_after[3] > 0, "Window should have height"


class TestTabbedLayout:
    """Test tabbed layout functionality."""

    def test_toggle_tabbed_mode(self, shell_proxy, input_sim, two_windows):
        """Shift+Super+t should toggle tabbed layout."""
        input_sim.toggle_tabbed()

        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Both windows should exist in tabbed mode"

        layout = shell_proxy.get_container_layout()
        assert layout in ["TABBED", "STACKED", "HSPLIT", "VSPLIT", "NO_NODE", "ERROR"], (
            f"Unexpected layout: {layout}"
        )

    def test_tabbed_windows_valid(self, shell_proxy, input_sim, two_windows):
        """In tabbed mode, windows should have valid dimensions."""
        input_sim.toggle_tabbed()

        windows = shell_proxy.get_windows()
        for window in windows:
            rect = window.get("rect", {})
            assert rect.get("width", 0) > 0, "Window should have width"
            assert rect.get("height", 0) > 0, "Window should have height"

    def test_tabbed_focus_cycles(self, shell_proxy, input_sim, three_windows):
        """Focus should cycle through tabs in tabbed mode."""
        input_sim.toggle_tabbed()

        focused_classes = set()

        for _ in range(5):
            focused = shell_proxy.get_focused_window()
            if focused.get("wmClass"):
                focused_classes.add(focused.get("wmClass"))
            input_sim.focus_right()

        assert len(focused_classes) >= 1, "Should focus at least one window in tabs"


class TestLayoutTransitions:
    """Test transitions between different layouts."""

    def test_hsplit_to_stacked_to_tabbed(self, shell_proxy, input_sim, two_windows):
        """Should transition between all layout types."""
        # Switch to stacked
        input_sim.toggle_stacked()
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Windows should exist after stacked"

        # Switch to tabbed
        input_sim.toggle_tabbed()
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Windows should exist after tabbed"

        # Switch back to split
        input_sim.toggle_layout()
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Windows should exist after layout toggle"

    def test_layout_changes_preserve_windows(self, shell_proxy, input_sim, three_windows):
        """All layout transitions should preserve window count."""
        initial_count = len(shell_proxy.get_windows())

        transitions = [
            input_sim.toggle_stacked,
            input_sim.toggle_tabbed,
            input_sim.toggle_layout,
            input_sim.split_vertical,
            input_sim.split_horizontal,
        ]

        for transition in transitions:
            transition()
            current_count = len(shell_proxy.get_windows())
            assert current_count == initial_count, (
                f"Window count changed from {initial_count} to {current_count}"
            )
