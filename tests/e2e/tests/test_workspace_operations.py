"""
Workspace Operation Tests for Forge.

Tests workspace navigation, per-workspace tiling toggle,
and moving windows between workspaces.
"""

import pytest

from framework.constants import Tolerance
from framework.wait import (
    wait_for,
    wait_for_stable,
    wait_for_window_count,
    wait_for_window_fill,
)


def _pull_window_back(shell_proxy, ws_index):
    """Move the first window on workspace ws_index+1 back to ws_index (no-op if none)."""
    shell_proxy.eval(f"""
    (function() {{
        var wsMgr = global.workspace_manager;
        var targetWs = wsMgr.get_workspace_by_index({ws_index + 1});
        if (targetWs) {{
            var wins = targetWs.list_windows();
            if (wins.length > 0) {{
                wins[0].change_workspace_by_index({ws_index}, false);
            }}
        }}
        return 'OK';
    }})();
    """)


class TestWorkspaceNavigation:
    """Test workspace switching preserves layout."""

    def test_window_visible_after_workspace_roundtrip(
        self, shell_proxy, input_sim, window_helper, test_window
    ):
        """Switching away and back should preserve window position."""
        wm_class = test_window.get("wmClass")
        rect_before = window_helper.get_window_rect(wm_class)
        start_ws = shell_proxy.get_active_workspace_index()

        # Switch to next workspace and back, waiting for each switch to land.
        input_sim.workspace_next()
        wait_for(shell_proxy.get_active_workspace_index, predicate=lambda i: i != start_ws)
        input_sim.workspace_prev()
        wait_for(shell_proxy.get_active_workspace_index, predicate=lambda i: i == start_ws)
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

        rect_after = window_helper.get_window_rect(wm_class)

        assert abs(rect_before[0] - rect_after[0]) < Tolerance.POSITION, (
            f"Window x changed after roundtrip: {rect_before[0]} -> {rect_after[0]}"
        )
        assert abs(rect_before[2] - rect_after[2]) < Tolerance.SIZE, (
            f"Window width changed after roundtrip: {rect_before[2]} -> {rect_after[2]}"
        )

    def test_workspace_switch_preserves_layout(
        self, shell_proxy, input_sim, window_helper, two_windows
    ):
        """Two-window layout should be preserved after workspace roundtrip."""
        wait_for_window_count(shell_proxy, 2)
        sorted_before = window_helper.get_windows_sorted_by_position("x")
        rects_before = [w.get("rect", {}) for w in sorted_before]
        start_ws = shell_proxy.get_active_workspace_index()

        input_sim.workspace_next()
        wait_for(shell_proxy.get_active_workspace_index, predicate=lambda i: i != start_ws)
        input_sim.workspace_prev()
        wait_for(shell_proxy.get_active_workspace_index, predicate=lambda i: i == start_ws)
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        sorted_after = window_helper.get_windows_sorted_by_position("x")
        rects_after = [w.get("rect", {}) for w in sorted_after]

        assert len(rects_after) == len(rects_before), "Window count changed"
        for before, after in zip(rects_before, rects_after):
            assert abs(before.get("x", 0) - after.get("x", 0)) < Tolerance.POSITION
            assert abs(before.get("width", 0) - after.get("width", 0)) < Tolerance.POSITION


class TestWorkspaceTileToggle:
    """Test per-workspace tiling toggle (Shift+Super+w)."""

    def test_toggle_disables_tiling(self, shell_proxy, test_window):
        """Toggling workspace tiling should add workspace to skip-tile list."""
        ws_index = shell_proxy.get_active_workspace_index()

        shell_proxy.invoke_forge_action({"name": "WorkspaceActiveTileToggle"})
        wait_for(lambda: shell_proxy.is_workspace_tiling_skipped(ws_index), predicate=bool)

        is_skipped = shell_proxy.is_workspace_tiling_skipped(ws_index)
        assert is_skipped, (
            f"Workspace {ws_index} should be in skip-tile list"
        )

        # Toggle back to clean up
        shell_proxy.invoke_forge_action({"name": "WorkspaceActiveTileToggle"})
        wait_for(
            lambda: shell_proxy.is_workspace_tiling_skipped(ws_index),
            predicate=lambda v: not v,
        )

    def test_double_toggle_restores_tiling(self, shell_proxy, test_window):
        """Toggling workspace tiling twice should restore tiling."""
        ws_index = shell_proxy.get_active_workspace_index()

        shell_proxy.invoke_forge_action({"name": "WorkspaceActiveTileToggle"})
        wait_for(lambda: shell_proxy.is_workspace_tiling_skipped(ws_index), predicate=bool)
        shell_proxy.invoke_forge_action({"name": "WorkspaceActiveTileToggle"})
        wait_for(
            lambda: shell_proxy.is_workspace_tiling_skipped(ws_index),
            predicate=lambda v: not v,
        )

        is_skipped = shell_proxy.is_workspace_tiling_skipped(ws_index)
        assert not is_skipped, f"Workspace {ws_index} should not be in skip-tile list"


class TestMoveWindowBetweenWorkspaces:
    """Test moving windows between workspaces."""

    def test_move_to_next_workspace(
        self, shell_proxy, window_helper, two_windows
    ):
        """Moving a window to next workspace should reduce count on current."""
        wait_for_window_count(shell_proxy, 2)
        count_before = len(shell_proxy.get_windows())
        ws_index = shell_proxy.get_active_workspace_index()

        # Move window via D-Bus (bypasses unreliable xdotool keybinding)
        shell_proxy.move_window_to_workspace(ws_index + 1)
        # forge-t3bb: the pull-back must survive a failing assert — a stranded
        # window on ws+1 outlives the test (clean_workspace sweeps only the
        # CURRENT workspace) and contaminates every later test.
        try:
            windows = wait_for_window_count(shell_proxy, count_before - 1)
            count_after = len(windows)

            assert count_after == count_before - 1, (
                f"Window count should decrease by 1: {count_before} -> {count_after}"
            )

            # Remaining window should fill workspace. Count hit 1, but the window
            # may still be re-tiling — wait for the fill before asserting.
            if count_after == 1:
                workspace = window_helper.get_workspace_rect()
                filled = wait_for_window_fill(shell_proxy, workspace)
                rect = filled.get("rect", {})
                assert abs(rect["width"] - workspace["width"]) < Tolerance.SIZE
        finally:
            _pull_window_back(shell_proxy, ws_index)
        wait_for_window_count(shell_proxy, count_before)

    def test_move_and_return(self, shell_proxy, two_windows):
        """Moving a window away and back should restore the original count."""
        wait_for_window_count(shell_proxy, 2)
        count_original = len(shell_proxy.get_windows())
        ws_index = shell_proxy.get_active_workspace_index()

        # Move window to next workspace via D-Bus
        shell_proxy.move_window_to_workspace(ws_index + 1)
        try:
            wait_for_window_count(shell_proxy, count_original - 1)
        finally:
            # Move it back (forge-t3bb: also the strand-proof cleanup — if the
            # wait above times out, the window must still come home).
            _pull_window_back(shell_proxy, ws_index)
        wait_for_window_count(shell_proxy, count_original)

        count_final = len(shell_proxy.get_windows())
        assert count_final == count_original, (
            f"Window count should be restored: {count_original} -> {count_final}"
        )
