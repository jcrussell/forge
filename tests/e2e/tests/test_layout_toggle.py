"""
Layout Toggle Tests for Forge.

Tests layout toggling between horizontal and vertical splits.
"""

from framework.constants import Tolerance
from framework.wait import wait_for, wait_for_layout


def _separation_axis(windows):
    """Axis the two leading tiled windows are primarily separated along.

    'x' => side by side (HSPLIT), 'y' => stacked top/bottom (VSPLIT). The
    fixtures launch same-class windows and get_windows() carries no id, so window
    *order* cannot prove a rearrangement; the geometric separation axis can, and
    it is exactly what a user sees (a row vs a column).
    """
    rects = [w.get("rect", {}) for w in windows[:2]]
    dx = abs(rects[0].get("x", 0) - rects[1].get("x", 0))
    dy = abs(rects[0].get("y", 0) - rects[1].get("y", 0))
    return "x" if dx >= dy else "y"


class TestLayoutToggle:
    """Test layout toggle functionality."""

    def test_toggle_hsplit_to_vsplit(self, shell_proxy, input_sim, two_windows):
        """Super+g must physically re-flow the windows between a row and a column.

        forge-izt: the old assert only checked width/height > 0 — a no-op toggle
        would pass. Assert the user-visible result instead: the two windows switch
        from side-by-side to stacked (or vice versa). wait_for_layout is only the
        settle; the separation-axis flip is the behavioral assertion.
        """
        shell_proxy.ensure_focus()
        layout_before = shell_proxy.get_container_layout()
        axis_before = _separation_axis(shell_proxy.get_windows())

        input_sim.toggle_layout()

        expected = "VSPLIT" if layout_before == "HSPLIT" else "HSPLIT"
        wait_for_layout(shell_proxy, expected)  # settle on the toggled container

        expected_axis = "y" if expected == "VSPLIT" else "x"
        axis_after = wait_for(
            lambda: _separation_axis(shell_proxy.get_windows()),
            predicate=lambda axis: axis == expected_axis,
            message=f"windows did not re-flow to a {expected} arrangement",
        )
        assert axis_after != axis_before, (
            f"toggle did not change the window arrangement (stayed separated along {axis_before})"
        )

    def test_double_toggle_restores_layout(
        self, shell_proxy, input_sim, window_helper, two_windows
    ):
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
        wait_for_layout(shell_proxy, "VSPLIT")  # gate on the actual layout flip

        windows = shell_proxy.get_windows()
        sorted_by_y = sorted(windows, key=lambda w: w.get("rect", {}).get("y", 0))

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
        wait_for_layout(shell_proxy, "HSPLIT")  # gate on the actual layout flip

        windows = shell_proxy.get_windows()
        sorted_by_x = sorted(windows, key=lambda w: w.get("rect", {}).get("x", 0))

        left = sorted_by_x[0].get("rect", {})
        right = sorted_by_x[-1].get("rect", {})

        # In horizontal layout, windows have similar height
        height_diff = abs(left.get("height", 0) - right.get("height", 0))
        assert height_diff < Tolerance.ALIGNMENT * 2, "Windows should have similar height in HSPLIT"


class TestLayoutWithMultipleWindows:
    """Test layout behavior with multiple windows."""

    def test_layout_toggle_three_windows(self, shell_proxy, input_sim, three_windows):
        """Layout toggle should work with three windows."""
        shell_proxy.ensure_focus()
        layout_before = shell_proxy.get_container_layout()

        input_sim.toggle_layout()

        expected = "VSPLIT" if layout_before == "HSPLIT" else "HSPLIT"
        wait_for_layout(shell_proxy, expected)  # the toggle actually flipped the layout

        windows = shell_proxy.get_windows()
        assert len(windows) >= 3, f"Expected 3 windows, got {len(windows)}"

        for window in windows:
            rect = window.get("rect", {})
            assert rect.get("width", 0) > 50, "Window too narrow"
            assert rect.get("height", 0) > 50, "Window too short"

    def test_layout_preserves_focus(self, shell_proxy, input_sim, window_helper, two_windows):
        """Layout toggle should keep focus on the same window.

        forge-2ij: wmClass-equality can't tell the two same-class fixture windows
        apart, so the old assert passed even if focus jumped to the sibling. Compare
        the stable window id (forge-gwo), and settle on the toggled layout first so
        the focus read isn't racing the re-tile.
        """
        shell_proxy.ensure_focus()
        layout_before = shell_proxy.get_container_layout()
        focused_id_before = window_helper.get_focused_id()

        input_sim.toggle_layout()
        expected = "VSPLIT" if layout_before == "HSPLIT" else "HSPLIT"
        wait_for_layout(shell_proxy, expected)  # the toggle settled

        focused_id_after = window_helper.get_focused_id()
        assert focused_id_after == focused_id_before, (
            f"Focus changed from window id {focused_id_before} to {focused_id_after}"
        )
