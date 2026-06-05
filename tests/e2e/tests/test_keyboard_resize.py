"""
Keyboard Resize Tests for Forge.

Tests keyboard-driven window resizing via Forge command actions.
Uses D-Bus action invocation to bypass unreliable xdotool focus in Xvfb.
"""

import pytest

from framework.constants import Tolerance
from framework.wait import wait_for_layout, wait_for_stable
from framework.workflow import invoke_resize as _invoke_resize


class TestKeyboardResize:
    """Test keyboard-driven window resizing."""

    def test_resize_horizontal_increase(
        self, shell_proxy, input_sim, window_helper, two_windows
    ):
        """Resize right increase should grow the focused window."""
        # Wait for the initial two-window tiling to settle before measuring.
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        sorted_before = window_helper.get_windows_sorted_by_position("x")
        assert len(sorted_before) >= 2
        left_width_before = sorted_before[0].get("rect", {}).get("width", 0)

        invoke_result = _invoke_resize(
            shell_proxy, "WindowResizeRight", focus_window="leftmost"
        )

        sorted_after = window_helper.get_windows_sorted_by_position("x")
        left_width_after = sorted_after[0].get("rect", {}).get("width", 0)

        assert left_width_after > left_width_before + Tolerance.RESIZE_MIN_DELTA, (
            f"Left window should be wider: {left_width_before} -> {left_width_after} "
            f"(invoke={invoke_result})"
        )

    def test_resize_horizontal_decrease(
        self, shell_proxy, input_sim, window_helper, two_windows
    ):
        """Resize left decrease should shrink the focused window."""
        # Wait for the initial two-window tiling to settle before measuring.
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        sorted_before = window_helper.get_windows_sorted_by_position("x")
        assert len(sorted_before) >= 2
        left_width_before = sorted_before[0].get("rect", {}).get("width", 0)

        _invoke_resize(
            shell_proxy, "WindowResizeRight", amount=-50, focus_window="leftmost"
        )

        sorted_after = window_helper.get_windows_sorted_by_position("x")
        left_width_after = sorted_after[0].get("rect", {}).get("width", 0)

        assert left_width_after < left_width_before - Tolerance.RESIZE_MIN_DELTA, (
            f"Left window should be narrower: {left_width_before} -> {left_width_after}"
        )

    def test_resize_vertical_in_vsplit(
        self, shell_proxy, input_sim, window_helper, two_windows
    ):
        """Resizing vertically in VSPLIT should change heights."""
        input_sim.toggle_layout()  # Switch to VSPLIT
        # forge-2ij: wait_for_stable alone is just two equal polls — it can return
        # before the container is actually VSPLIT (the resize target depends on the
        # split orientation). Gate on the layout flip first, THEN let geometry
        # settle, so the resize runs against a fully-settled vertical split.
        wait_for_layout(shell_proxy, "VSPLIT")
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("y"))

        sorted_before = window_helper.get_windows_sorted_by_position("y")
        assert len(sorted_before) >= 2
        top_height_before = sorted_before[0].get("rect", {}).get("height", 0)

        # Pin the top pane as the resize target: WindowResizeBottom grows the
        # focused window's south edge, and post-toggle natural focus is the bottom
        # pane (the two_windows fixture focuses the second window). The explicit
        # hint makes this deterministic across X11/Wayland (see shell_proxy).
        _invoke_resize(shell_proxy, "WindowResizeBottom", focus_window="topmost")

        sorted_after = window_helper.get_windows_sorted_by_position("y")
        top_height_after = sorted_after[0].get("rect", {}).get("height", 0)

        assert top_height_after > top_height_before + Tolerance.RESIZE_MIN_DELTA, (
            f"Top window should be taller: {top_height_before} -> {top_height_after}"
        )

    def test_resize_preserves_coverage(
        self, shell_proxy, window_helper, two_windows
    ):
        """Windows should still fill workspace after resize."""
        # Wait for the initial two-window tiling to settle before resizing.
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        _invoke_resize(shell_proxy, "WindowResizeRight")

        window_helper.assert_windows_fill_workspace()


class TestResetSizes:
    """Test resetting window sizes to equal."""

    def test_reset_equalizes_after_resize(
        self, shell_proxy, window_helper, two_windows
    ):
        """WindowResetSizes should reset windows to equal sizes after resize."""
        # Wait for the initial two-window tiling to settle before resizing.
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        # Make windows unequal via D-Bus action
        _invoke_resize(shell_proxy, "WindowResizeRight")

        # Reset via D-Bus action
        shell_proxy.invoke_forge_action({"name": "WindowResetSizes"})
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        sorted_wins = window_helper.get_windows_sorted_by_position("x")
        assert len(sorted_wins) >= 2

        width1 = sorted_wins[0].get("rect", {}).get("width", 0)
        width2 = sorted_wins[1].get("rect", {}).get("width", 0)

        assert abs(width1 - width2) < Tolerance.ALIGNMENT, (
            f"Widths should be roughly equal after reset: {width1} vs {width2}"
        )
