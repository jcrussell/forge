"""
Workflow WF2: open / close rebalance workflow (forge-911 / forge-3bw).

Drives a 3-window set down to one and back up, asserting the tree rebalances and
stays valid at each step. Folds the close-rebalance, sequential-close,
tree-integrity-after-close and focus-after-close atomic concerns into a single
launch set, and adds the realistic mid-sequence RE-OPEN (a new window appearing
after windows have closed) that the atomic suite never exercises.

Closes go through shell_proxy.close_one_window() (a deterministic D-Bus
window.delete) rather than an alt+F4 keypress, so every step has a pollable
post-condition under Xvfb — consistent with the rest of the suite.
"""

from framework.constants import Tolerance
from framework.wait import (
    wait_for_layout_settled,
    wait_for_stable,
    wait_for_window_count,
    wait_for_window_fill,
)
from framework.workflow import step


class TestWorkflowRebalance:
    """One 3-window set, closed down and re-opened, checking rebalance + integrity."""

    def test_open_close_rebalance(
        self, shell_proxy, window_helper, three_windows, launch_window
    ):
        workspace = window_helper.get_workspace_rect()

        with step(shell_proxy, "three windows tile and fill the workspace"):
            wait_for_window_count(shell_proxy, 3)
            wait_for_layout_settled(shell_proxy, workspace)
            window_helper.assert_windows_fill_workspace()

        with step(shell_proxy, "close one -> remaining two rebalance, tree valid"):
            shell_proxy.close_one_window()
            wait_for_window_count(shell_proxy, 2)
            wait_for_layout_settled(shell_proxy, workspace)
            window_helper.assert_windows_fill_workspace()
            shell_proxy.wait_for_idle()
            result = shell_proxy.verify_tree_integrity()
            assert result.get("valid", False), (
                f"tree invalid after first close: {result.get('errors')}"
            )

        with step(shell_proxy, "close another -> last window fills, tree valid"):
            shell_proxy.close_one_window()
            wait_for_window_count(shell_proxy, 1)
            wait_for_window_fill(shell_proxy, workspace)
            rect = shell_proxy.get_windows()[0].get("rect", {})
            assert abs(rect["width"] - workspace["width"]) < Tolerance.SIZE, (
                f"remaining window width {rect['width']} should fill {workspace['width']}"
            )
            shell_proxy.wait_for_idle()
            result = shell_proxy.verify_tree_integrity()
            assert result.get("valid", False), (
                f"tree invalid after second close: {result.get('errors')}"
            )

        with step(shell_proxy, "open a new window -> it re-tiles side by side"):
            launch_window()
            wait_for_window_count(shell_proxy, 2)
            wait_for_layout_settled(shell_proxy, workspace)
            cols = window_helper.get_windows_sorted_by_position("x")
            left, right = cols[0]["rect"], cols[1]["rect"]
            assert abs(right["x"] - (left["x"] + left["width"])) < Tolerance.SIZE, (
                f"re-opened pair not side by side: left ends {left['x'] + left['width']}, "
                f"right at {right['x']}"
            )
            window_helper.assert_windows_fill_workspace()

        with step(shell_proxy, "close once more -> focus lands on the survivor"):
            shell_proxy.close_one_window()
            wait_for_window_count(shell_proxy, 1)
            wait_for_stable(lambda: shell_proxy.get_windows())
            assert shell_proxy.get_focused_window().get("wmClass"), (
                "a window should be focused after closing the focused one"
            )
