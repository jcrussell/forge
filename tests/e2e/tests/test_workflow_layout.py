"""
Workflow WF1: layout / resize / swap workflow (forge-911 / forge-6iy).

Drives one 2-window set through tile -> VSPLIT -> resize -> reset -> HSPLIT ->
resize -> swap, asserting at each step. Folds the basic-tiling, layout-toggle,
keyboard-resize and reset-sizes atomic concerns into a single launch (~2 launches
vs ~24 across the atomic tests it overlaps) and exercises the realistic sequence
of re-laying-out and resizing the SAME windows that the one-op atomic tests never
cover.

Both test windows share a wmClass (gnome-text-editor), so geometry is read via
position-sorted rects, never the class-based WindowHelper asserts (which can't
disambiguate two identical classes).
"""

from framework.constants import Tolerance
from framework.wait import wait_for_layout, wait_for_stable, wait_for_window_count
from framework.workflow import invoke_resize, step


class TestWorkflowLayout:
    """One two-window set, sequenced through layout/resize/swap operations."""

    def test_layout_resize_swap(
        self, shell_proxy, input_sim, window_helper, two_windows
    ):
        with step(shell_proxy, "two windows tile 50/50 side by side"):
            wait_for_window_count(shell_proxy, 2)
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
            cols = window_helper.get_windows_sorted_by_position("x")
            left, right = cols[0]["rect"], cols[1]["rect"]
            assert abs(right["x"] - (left["x"] + left["width"])) < Tolerance.SIZE, (
                f"not side by side: left ends {left['x'] + left['width']}, right at {right['x']}"
            )
            assert abs(left["height"] - right["height"]) < Tolerance.ALIGNMENT
            window_helper.assert_windows_fill_workspace()

        with step(shell_proxy, "toggle to VSPLIT -> windows stack vertically"):
            input_sim.toggle_layout()
            wait_for_layout(shell_proxy, "VSPLIT")
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("y"))
            rows = window_helper.get_windows_sorted_by_position("y")
            top, bottom = rows[0]["rect"], rows[1]["rect"]
            assert abs(bottom["y"] - (top["y"] + top["height"])) < Tolerance.SIZE, (
                f"not stacked: top ends {top['y'] + top['height']}, bottom at {bottom['y']}"
            )

        with step(shell_proxy, "resize top pane's bottom edge down -> top grows"):
            top_h_before = window_helper.get_windows_sorted_by_position("y")[0]["rect"]["height"]
            # focus_window + also_activate (via invoke_resize) so the async
            # split-ratio finalizer targets the genuinely-focused pane (forge-2n0).
            invoke_resize(shell_proxy, "WindowResizeBottom", focus_window="topmost")
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("y"))
            top_h_after = window_helper.get_windows_sorted_by_position("y")[0]["rect"]["height"]
            assert top_h_after > top_h_before + Tolerance.RESIZE_MIN_DELTA, (
                f"top pane should be taller: {top_h_before} -> {top_h_after}"
            )

        with step(shell_proxy, "reset sizes -> panes equal height again"):
            shell_proxy.invoke_forge_action({"name": "WindowResetSizes"})
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("y"))
            rows = window_helper.get_windows_sorted_by_position("y")
            assert abs(rows[0]["rect"]["height"] - rows[1]["rect"]["height"]) < Tolerance.SIZE, (
                "panes should be equal height after reset"
            )

        with step(shell_proxy, "toggle back to HSPLIT -> side by side, focus kept"):
            input_sim.toggle_layout()
            wait_for_layout(shell_proxy, "HSPLIT")
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
            cols = window_helper.get_windows_sorted_by_position("x")
            left, right = cols[0]["rect"], cols[1]["rect"]
            assert abs(right["x"] - (left["x"] + left["width"])) < Tolerance.SIZE
            assert shell_proxy.get_focused_window().get("wmClass"), (
                "a window should still be focused after toggling layout"
            )

        with step(shell_proxy, "resize left pane's right edge -> left grows, still fills"):
            left_w_before = window_helper.get_windows_sorted_by_position("x")[0]["rect"]["width"]
            invoke_resize(shell_proxy, "WindowResizeRight", focus_window="leftmost")
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
            left_w_after = window_helper.get_windows_sorted_by_position("x")[0]["rect"]["width"]
            assert left_w_after > left_w_before + Tolerance.RESIZE_MIN_DELTA, (
                f"left pane should be wider: {left_w_before} -> {left_w_after}"
            )
            window_helper.assert_windows_fill_workspace()

        with step(shell_proxy, "swap the panes back and forth -> count stays 2"):
            input_sim.swap_left()
            input_sim.swap_right()
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
            assert len(shell_proxy.get_windows()) == 2, "swap must preserve window count"
