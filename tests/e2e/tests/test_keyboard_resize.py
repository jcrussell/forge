"""
Keyboard Resize Tests for Forge.

Tests keyboard-driven window resizing via Forge command actions.
Uses D-Bus action invocation to bypass unreliable xdotool focus in Xvfb.
"""

from framework.constants import Tolerance
from framework.wait import wait_for_layout, wait_for_stable
from framework.workflow import invoke_resize as _invoke_resize


class TestKeyboardResize:
    """Test keyboard-driven window resizing."""

    def test_resize_horizontal_increase(self, shell_proxy, input_sim, window_helper, two_windows):
        """Resize right increase should grow the focused window."""
        # Wait for the initial two-window tiling to settle before measuring.
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        sorted_before = window_helper.get_windows_sorted_by_position("x")
        assert len(sorted_before) >= 2
        left_width_before = sorted_before[0].get("rect", {}).get("width", 0)

        invoke_result = _invoke_resize(shell_proxy, "WindowResizeRight", focus_window="leftmost")

        sorted_after = window_helper.get_windows_sorted_by_position("x")
        left_width_after = sorted_after[0].get("rect", {}).get("width", 0)

        assert left_width_after > left_width_before + Tolerance.RESIZE_MIN_DELTA, (
            f"Left window should be wider: {left_width_before} -> {left_width_after} "
            f"(invoke={invoke_result})"
        )

    def test_resize_horizontal_decrease(self, shell_proxy, input_sim, window_helper, two_windows):
        """Resize left decrease should shrink the focused window."""
        # Wait for the initial two-window tiling to settle before measuring.
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        sorted_before = window_helper.get_windows_sorted_by_position("x")
        assert len(sorted_before) >= 2
        left_width_before = sorted_before[0].get("rect", {}).get("width", 0)

        _invoke_resize(shell_proxy, "WindowResizeRight", amount=-50, focus_window="leftmost")

        sorted_after = window_helper.get_windows_sorted_by_position("x")
        left_width_after = sorted_after[0].get("rect", {}).get("width", 0)

        assert left_width_after < left_width_before - Tolerance.RESIZE_MIN_DELTA, (
            f"Left window should be narrower: {left_width_before} -> {left_width_after}"
        )

    def test_resize_vertical_in_vsplit(self, shell_proxy, input_sim, window_helper, two_windows):
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

    def test_resize_preserves_coverage(self, shell_proxy, window_helper, two_windows):
        """Windows should still fill workspace after resize."""
        # Wait for the initial two-window tiling to settle before resizing.
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        _invoke_resize(shell_proxy, "WindowResizeRight")

        window_helper.assert_windows_fill_workspace()


class TestResizeBoundaryIndependence:
    """forge-12f (gh-305): resizing one boundary must not move the opposite one.

    In a 3-window HSPLIT [W1|W2|W3], growing W1's east edge moves only the
    W1|W2 boundary; the W2|W3 boundary and W3 must stay put. The reported bug
    was the opposite boundary shifting too.
    """

    def test_resize_one_boundary_leaves_the_other_fixed(
        self, shell_proxy, window_helper, three_windows
    ):
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        before = window_helper.get_windows_sorted_by_position("x")
        assert len(before) == 3, f"Expected 3 tiled windows, got {len(before)}"
        w1_before, _, w3_before = (w.get("rect", {}) for w in before)

        _invoke_resize(shell_proxy, "WindowResizeRight", focus_window="leftmost")

        after = window_helper.get_windows_sorted_by_position("x")
        assert len(after) == 3, f"Expected 3 tiled windows after resize, got {len(after)}"
        w1_after, _, w3_after = (w.get("rect", {}) for w in after)

        # Sanity: the resize actually landed (W1's east edge moved right).
        assert w1_after.get("width", 0) > w1_before.get("width", 0) + Tolerance.RESIZE_MIN_DELTA, (
            f"W1 should be wider: {w1_before.get('width')} -> {w1_after.get('width')}"
        )
        # W1's west edge is untouched.
        assert abs(w1_after.get("x", -1) - w1_before.get("x", -1)) <= Tolerance.POSITION, (
            f"W1's west edge moved: {w1_before.get('x')} -> {w1_after.get('x')}"
        )
        # The OPPOSITE boundary (W2|W3) must not move: W3 keeps its x and width.
        assert abs(w3_after.get("x", -1) - w3_before.get("x", -1)) <= Tolerance.POSITION, (
            f"W2|W3 boundary moved: W3.x {w3_before.get('x')} -> {w3_after.get('x')}"
        )
        assert abs(w3_after.get("width", -1) - w3_before.get("width", -1)) <= Tolerance.POSITION, (
            f"W3 resized: width {w3_before.get('width')} -> {w3_after.get('width')}"
        )


class TestResetSizes:
    """Test resetting window sizes to equal."""

    def test_reset_equalizes_after_resize(self, shell_proxy, window_helper, two_windows):
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
