"""
Minimum-size-aware tiling (forge-s6g / forge-kvao).

forge-s6g made Tree.computeSizes() honor window minimum sizes by redistributing
tile space (i3-style): a window whose minimum exceeds its percentage slice is
floored at its minimum and its slack-bearing siblings shrink, so a large-min
window never overlaps its neighbour.

No headless app reliably reports a large minimum width, so this drives the
behavior deterministically: a bridge helper shadows get_size_hints() on the
leftmost tiled window with a minimum wider than its 50% share, then re-renders.
We then assert from the rendered frames that the constrained window grew past
its equal share AND that the two windows do not overlap.
"""

import pytest

from framework.constants import Tolerance
from framework.wait import wait_for_window_count


class TestMinSizeTiling:
    """End-to-end coverage for minimum-size-aware tiling."""

    def test_minwidth_window_honored_without_overlap(
        self, shell_proxy, window_helper, two_windows
    ):
        """A window with a min-width wider than its slice keeps its minimum and
        does not overlap its neighbour."""
        wait_for_window_count(shell_proxy, 2)

        workspace = window_helper.get_workspace_rect()
        ws_width = workspace["width"]
        half = ws_width // 2

        # A minimum noticeably wider than the equal 50% share, but still leaving
        # room for the sibling (70% of the workspace).
        min_width = int(ws_width * 0.7)

        windows = shell_proxy.get_windows()
        wm_class = windows[0].get("wmClass")
        assert wm_class, "test windows should report a wmClass"

        try:
            result = shell_proxy.eval(
                "globalThis._forgeTestBridge.setLeftmostWindowMinSize('%s', %d, 0)"
                % (wm_class, min_width)
            )
            assert isinstance(result, dict) and result.get("ok"), (
                f"setLeftmostWindowMinSize failed: {result!r}"
            )

            # renderTree is async (GLib.idle_add); wait for the render to settle
            # before measuring the rendered frames.
            shell_proxy.wait_for_idle()

            sorted_windows = sorted(
                shell_proxy.get_windows(), key=lambda w: w.get("rect", {}).get("x", 0)
            )
            assert len(sorted_windows) >= 2, "expected two tiled windows"
            left = sorted_windows[0]["rect"]
            right = sorted_windows[1]["rect"]

            # The constrained window kept (approximately) its minimum width...
            assert left["width"] >= min_width - Tolerance.SIZE, (
                f"constrained window width {left['width']} should be ~>= min {min_width}"
            )
            # ...which is more than the equal split it would have gotten otherwise.
            assert left["width"] > half, (
                f"constrained window {left['width']} should exceed its equal share {half}"
            )
            # And the two windows must not overlap.
            left_end = left["x"] + left["width"]
            assert left_end <= right["x"] + Tolerance.OVERLAP, (
                f"windows overlap: left ends at {left_end}, right starts at {right['x']}"
            )
        finally:
            shell_proxy.eval(
                "globalThis._forgeTestBridge.resetWindowMinSize('%s')" % wm_class
            )
            shell_proxy.wait_for_idle()
