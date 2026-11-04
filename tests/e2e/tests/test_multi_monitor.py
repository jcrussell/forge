"""Multi-monitor tiling E2E coverage (forge-a34.1).

Requires a dual-monitor session: run with FORGE_E2E_VIRTUAL_MONITORS=2 (e.g.
`make e2e-test-multimonitor`), which adds a second 1920x1080 virtual output in
start-user-session.sh. The test self-skips on single-monitor lanes so it is safe
in the default suite.
"""

import time

import pytest
from framework.constants import Timing
from framework.wait import wait_for

pytestmark = pytest.mark.multimonitor

# Second virtual monitor starts at x=1920 (monitors are 1920 wide, side by side).
MONITOR_1_X = 1920

# The ordinary (non-sticky) window on the primary monitor.
_PRIMARY_WINDOW_JS = """
global.get_window_actors().map(function(a){ return a.meta_window; }).filter(function(w){
    return w.get_monitor() === global.display.get_primary_monitor() &&
        !w.is_on_all_workspaces() && w.get_window_type() === Meta.WindowType.NORMAL;
})[0]
"""
MOVE_PRIMARY_WINDOW_JS = (
    "(function(){ var w = "
    + _PRIMARY_WINDOW_JS
    + "; if (!w) return 'none'; w.change_workspace_by_index(%d, false); return 'ok'; })();"
)
ACTIVATE_PRIMARY_WINDOW_JS = (
    "(function(){ var w = "
    + _PRIMARY_WINDOW_JS
    + "; if (!w) return 'none'; w.activate(global.get_current_time()); return 'ok'; })();"
)


class TestMultiMonitorTiling:
    def test_window_retiles_across_monitors(self, shell_proxy, two_windows):
        """Moving a window to monitor 2 should re-tile each monitor independently."""
        if shell_proxy.get_monitor_count() < 2:
            pytest.skip("requires 2 virtual monitors (FORGE_E2E_VIRTUAL_MONITORS=2)")

        # Both windows start tiled (side by side) on the primary monitor.
        xs = [w.get("rect", {}).get("x", 0) for w in shell_proxy.get_windows()]
        assert xs and all(x < MONITOR_1_X for x in xs), (
            f"both windows should start on monitor 0, got xs={xs}"
        )

        # Move the focused window to the second monitor.
        shell_proxy.ensure_focus()
        assert shell_proxy.move_focused_window_to_monitor(1) == "ok"

        # Poll until BOTH monitors have re-tiled: one window each, each filling its
        # monitor (~full 1920 width minus gaps). The move and the monitor-0 re-tile
        # settle a beat apart, so the width check must be inside the wait predicate.
        def settled_split():
            wins = shell_proxy.get_windows()
            if len(wins) != 2:
                return None
            on0 = [w for w in wins if w.get("rect", {}).get("x", 0) < MONITOR_1_X]
            on1 = [w for w in wins if w.get("rect", {}).get("x", 0) >= MONITOR_1_X]
            if len(on0) != 1 or len(on1) != 1:
                return None
            if on0[0]["rect"]["width"] <= 1700 or on1[0]["rect"]["width"] <= 1700:
                return None
            return (on0[0], on1[0])

        on0, on1 = wait_for(
            settled_split,
            predicate=lambda r: r is not None,
            message="each monitor should hold one window filling it after the move",
        )
        # Proves Forge tiles the two monitors independently rather than sharing one.
        assert on0["rect"]["width"] > 1700 and on1["rect"]["width"] > 1700

    def test_focus_reaches_sticky_monitor_after_workspace_switch(
        self, shell_proxy, two_windows, input_sim
    ):
        """Directional focus reaches the non-primary monitor on every workspace.

        With workspaces-only-on-primary (pinned true on this lane), windows on the
        non-primary monitor follow the active workspace without any per-window
        workspace-changed, so Forge re-homes them on the switch itself.
        """
        if shell_proxy.get_monitor_count() < 2:
            pytest.skip("requires 2 virtual monitors (FORGE_E2E_VIRTUAL_MONITORS=2)")

        shell_proxy.ensure_focus()
        assert shell_proxy.move_focused_window_to_monitor(1) == "ok"
        wait_for(
            lambda: [
                w for w in shell_proxy.get_windows() if w.get("rect", {}).get("x", 0) >= MONITOR_1_X
            ],
            predicate=lambda on1: len(on1) == 1,
            message="one window should land on the non-primary monitor",
        )

        start_ws = shell_proxy.get_active_workspace_index()
        target_ws = (start_ws + 1) % shell_proxy.get_workspace_count()
        try:
            # Send the primary-monitor window ahead while start_ws is still active:
            # its workspace-changed reconcile must not be what re-homes the sticky
            # window, so the switch below is the only event left to do it.
            assert shell_proxy.eval(MOVE_PRIMARY_WINDOW_JS % target_ws) == "ok"
            time.sleep(Timing.WINDOW_SETTLE)
            shell_proxy.activate_workspace(target_ws)
            wait_for(
                shell_proxy.get_active_workspace_index,
                predicate=lambda ws: ws == target_ws,
                message="the target workspace should become active",
            )
            assert shell_proxy.eval(ACTIVATE_PRIMARY_WINDOW_JS) == "ok"
            wait_for(
                shell_proxy.get_focused_window,
                predicate=lambda w: w and w.get("rect", {}).get("x", MONITOR_1_X) < MONITOR_1_X,
                message="the moved window should be focused on the primary monitor",
            )

            input_sim.focus_right()

            focused = wait_for(
                shell_proxy.get_focused_window,
                predicate=lambda w: w and w.get("rect", {}).get("x", 0) >= MONITOR_1_X,
                message="focus right should reach the sticky window on the non-primary monitor",
            )
            assert focused["rect"]["x"] >= MONITOR_1_X
        finally:
            # Both remaining windows are visible on target_ws (one sticky).
            shell_proxy.close_all_windows()
            shell_proxy.activate_workspace(start_ws)
