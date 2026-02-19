"""
Workspace Operation Tests for Forge.

Tests workspace navigation, per-workspace tiling toggle,
and moving windows between workspaces.
"""

import time

import pytest

from framework.constants import Timing, Tolerance
from framework.wait import wait_for_window_count


class TestWorkspaceNavigation:
    """Test workspace switching preserves layout."""

    def test_window_visible_after_workspace_roundtrip(
        self, shell_proxy, input_sim, window_helper, test_window
    ):
        """Switching away and back should preserve window position."""
        wm_class = test_window.get("wmClass")
        rect_before = window_helper.get_window_rect(wm_class)

        # Switch to next workspace and back
        input_sim.workspace_next()
        time.sleep(Timing.WORKSPACE_SWITCH)
        input_sim.workspace_prev()
        time.sleep(Timing.WORKSPACE_SWITCH)

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
        time.sleep(Timing.WINDOW_SETTLE)
        sorted_before = window_helper.get_windows_sorted_by_position("x")
        rects_before = [w.get("rect", {}) for w in sorted_before]

        input_sim.workspace_next()
        time.sleep(Timing.WORKSPACE_SWITCH)
        input_sim.workspace_prev()
        time.sleep(Timing.WORKSPACE_SWITCH)

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
        time.sleep(Timing.SETTINGS_SETTLE)

        is_skipped = shell_proxy.is_workspace_tiling_skipped(ws_index)
        assert is_skipped, (
            f"Workspace {ws_index} should be in skip-tile list"
        )

        # Toggle back to clean up
        shell_proxy.invoke_forge_action({"name": "WorkspaceActiveTileToggle"})
        time.sleep(Timing.SETTINGS_SETTLE)

    def test_double_toggle_restores_tiling(self, shell_proxy, test_window):
        """Toggling workspace tiling twice should restore tiling."""
        ws_index = shell_proxy.get_active_workspace_index()

        shell_proxy.invoke_forge_action({"name": "WorkspaceActiveTileToggle"})
        time.sleep(Timing.SETTINGS_SETTLE)
        shell_proxy.invoke_forge_action({"name": "WorkspaceActiveTileToggle"})
        time.sleep(Timing.SETTINGS_SETTLE)

        is_skipped = shell_proxy.is_workspace_tiling_skipped(ws_index)
        assert not is_skipped, f"Workspace {ws_index} should not be in skip-tile list"


class TestMoveWindowBetweenWorkspaces:
    """Test moving windows between workspaces."""

    def test_move_to_next_workspace(
        self, shell_proxy, window_helper, two_windows
    ):
        """Moving a window to next workspace should reduce count on current."""
        time.sleep(Timing.WINDOW_SETTLE)
        count_before = len(shell_proxy.get_windows())
        ws_index = shell_proxy.get_active_workspace_index()

        # Move window via D-Bus (bypasses unreliable xdotool keybinding)
        shell_proxy.move_window_to_workspace(ws_index + 1)
        time.sleep(Timing.WORKSPACE_SWITCH)

        windows = shell_proxy.get_windows()
        count_after = len(windows)

        assert count_after == count_before - 1, (
            f"Window count should decrease by 1: {count_before} -> {count_after}"
        )

        # Remaining window should fill workspace
        if count_after == 1:
            workspace = window_helper.get_workspace_rect()
            rect = windows[0].get("rect", {})
            assert abs(rect["width"] - workspace["width"]) < Tolerance.SIZE

        # Clean up: switch to target workspace and move window back
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
        time.sleep(Timing.WORKSPACE_SWITCH)

    def test_move_and_return(self, shell_proxy, two_windows):
        """Moving a window away and back should restore the original count."""
        time.sleep(Timing.WINDOW_SETTLE)
        count_original = len(shell_proxy.get_windows())
        ws_index = shell_proxy.get_active_workspace_index()

        # Move window to next workspace via D-Bus
        shell_proxy.move_window_to_workspace(ws_index + 1)
        time.sleep(Timing.WORKSPACE_SWITCH)

        # Move it back
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
        time.sleep(Timing.WORKSPACE_SWITCH)

        count_final = len(shell_proxy.get_windows())
        assert count_final == count_original, (
            f"Window count should be restored: {count_original} -> {count_final}"
        )
