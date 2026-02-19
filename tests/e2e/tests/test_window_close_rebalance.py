"""
Window Close Rebalance Tests for Forge.

Tests that closing windows causes remaining windows to expand
and fill the freed space correctly.
"""

import time

import pytest

from framework.constants import Timing, Tolerance
from framework.wait import wait_for_window_count


class TestWindowCloseRebalance:
    """Test that closing windows rebalances remaining windows."""

    def test_close_one_of_two_fills_workspace(
        self, shell_proxy, window_helper, two_windows
    ):
        """Closing one of two tiled windows should make the remaining fill workspace."""
        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 1)
        time.sleep(Timing.LAYOUT_CHANGE)

        windows = shell_proxy.get_windows()
        assert len(windows) == 1, f"Expected 1 window, got {len(windows)}"

        workspace = window_helper.get_workspace_rect()
        rect = windows[0].get("rect", {})
        assert abs(rect["width"] - workspace["width"]) < Tolerance.SIZE, (
            f"Remaining window width {rect['width']} should fill workspace {workspace['width']}"
        )

    def test_close_one_of_three_rebalances(
        self, shell_proxy, window_helper, three_windows
    ):
        """Closing one of three windows should rebalance remaining two."""
        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 2)
        time.sleep(Timing.LAYOUT_CHANGE)

        window_helper.assert_windows_fill_workspace()

    def test_sequential_close_to_one(
        self, shell_proxy, window_helper, three_windows
    ):
        """Closing windows one by one should rebalance at each step."""
        # Close first window
        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 2)
        time.sleep(Timing.LAYOUT_CHANGE)
        window_helper.assert_windows_fill_workspace()

        # Close second window
        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 1)
        time.sleep(Timing.LAYOUT_CHANGE)

        windows = shell_proxy.get_windows()
        assert len(windows) == 1
        workspace = window_helper.get_workspace_rect()
        rect = windows[0].get("rect", {})
        assert abs(rect["width"] - workspace["width"]) < Tolerance.SIZE

    def test_close_in_vsplit_rebalances(
        self, shell_proxy, input_sim, window_helper, two_windows
    ):
        """Closing a window in VSPLIT should make the remaining fill workspace."""
        input_sim.toggle_layout()  # Switch to VSPLIT
        time.sleep(Timing.LAYOUT_CHANGE)

        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 1)
        time.sleep(Timing.LAYOUT_CHANGE)

        windows = shell_proxy.get_windows()
        assert len(windows) == 1
        workspace = window_helper.get_workspace_rect()
        rect = windows[0].get("rect", {})
        assert abs(rect["height"] - workspace["height"]) < Tolerance.SIZE, (
            f"Remaining window height {rect['height']} should fill workspace {workspace['height']}"
        )


class TestTreeIntegrityAfterClose:
    """Test that the Forge tree remains valid after closing windows."""

    def test_tree_valid_after_close(self, shell_proxy, three_windows):
        """Tree should remain valid after closing windows."""
        # Close one window
        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 2)
        time.sleep(Timing.LAYOUT_CHANGE)

        result = shell_proxy.verify_tree_integrity()
        assert result.get("valid", False), (
            f"Tree invalid after first close: {result.get('errors')}"
        )

        # Close another window
        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 1)
        time.sleep(Timing.LAYOUT_CHANGE)

        result = shell_proxy.verify_tree_integrity()
        assert result.get("valid", False), (
            f"Tree invalid after second close: {result.get('errors')}"
        )

    def test_close_in_stacked_layout(self, shell_proxy, input_sim, three_windows):
        """Tree should remain valid after closing a window in stacked layout."""
        input_sim.toggle_stacked()
        time.sleep(Timing.LAYOUT_CHANGE)

        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 2)
        time.sleep(Timing.LAYOUT_CHANGE)

        result = shell_proxy.verify_tree_integrity()
        assert result.get("valid", False), (
            f"Tree invalid after stacked close: {result.get('errors')}"
        )

        windows = shell_proxy.get_windows()
        assert len(windows) == 2, f"Expected 2 windows, got {len(windows)}"
