"""
E2E for forge-7m3: adding a new window must not re-equalize the existing windows'
custom-resized proportions.

Repro: tile two windows, resize them unequal, then open a third window. If Forge
zeroes every sibling's percent on track (window.js trackWindow), the layout
collapses to equal thirds and the user's sizing is lost. A correct fix preserves
the existing windows' relative proportions while giving the newcomer a share.

All test windows share a wm_class, so we reason about the SET of widths rather
than per-window identity: in the bug the three widths are all ~equal; preserved
sizing keeps a clear spread.
"""

import time

import pytest

from framework.constants import Timing
from framework.wait import wait_for_stable, wait_for_window_count
from framework.workflow import invoke_resize


def _width_spread(window_helper):
    """max/min width across the tiled windows (1.0 == all equal)."""
    wins = window_helper.get_windows_sorted_by_position("x")
    widths = [w.get("rect", {}).get("width", 0) for w in wins]
    widths = [w for w in widths if w > 0]
    if not widths:
        return 0.0, widths
    return max(widths) / min(widths), widths


class TestNewWindowPreservesProportions:
    def test_adding_window_preserves_existing_proportions(
        self, shell_proxy, window_helper, two_windows, launch_window
    ):
        wait_for_window_count(shell_proxy, 2)

        # Make the two windows clearly unequal.
        invoke_resize(shell_proxy, "WindowResizeRight", focus_window="leftmost")
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        spread_before, widths_before = _width_spread(window_helper)
        assert spread_before > 1.5, (
            f"resize did not make windows unequal enough to test: {widths_before}"
        )

        # Open a third window into the same container.
        launch_window()
        wait_for_window_count(shell_proxy, 3)
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
        time.sleep(Timing.WINDOW_SETTLE)

        spread_after, widths_after = _width_spread(window_helper)
        # If proportions were preserved, the spread stays well above 1.0 (the
        # previously-wide window is still clearly wider). The bug collapses all
        # three to ~equal thirds (spread ~1.0).
        assert spread_after > 1.4, (
            f"adding a window re-equalized existing proportions: "
            f"before={widths_before} (spread {spread_before:.2f}) -> "
            f"after={widths_after} (spread {spread_after:.2f})"
        )
