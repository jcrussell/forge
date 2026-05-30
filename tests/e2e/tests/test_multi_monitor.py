"""Multi-monitor tiling E2E coverage (forge-a34.1).

Requires a dual-monitor session: run with FORGE_E2E_VIRTUAL_MONITORS=2 (e.g.
`make e2e-test-multimonitor`), which adds a second 1920x1080 virtual output in
start-user-session.sh. The test self-skips on single-monitor lanes so it is safe
in the default suite.
"""

import pytest

from framework.wait import wait_for

# Second virtual monitor starts at x=1920 (monitors are 1920 wide, side by side).
MONITOR_1_X = 1920


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
