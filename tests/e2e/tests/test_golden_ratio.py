"""
E2E test for the golden-ratio resize command (forge-zlg).

WindowGoldenRatio resizes the focused tiled window to the golden-ratio share
(phi^-1 ~= 0.618) of its split pair. The keybinding ships unbound, so the command
is dispatched directly via the test bridge (invoke_forge_action).
"""

import time

from framework.constants import Timing

GOLDEN = 0.6180339887


class TestGoldenRatio:
    """Golden-ratio one-shot resize."""

    def test_focused_window_gets_golden_share(self, shell_proxy, window_helper, two_windows):
        """The focused window should claim ~61.8% of a two-window row."""
        # Wait for the two windows to tile side by side before measuring.
        windows = window_helper.get_windows_sorted_by_position("x")
        assert len(windows) == 2, f"expected 2 tiled windows, got {len(windows)}"

        # Apply golden ratio with the LEFT window focused; it should grow to the
        # golden (larger) share. focus_window + also_activate give the command a
        # real focus target under Xvfb (where get_focus_window is null).
        shell_proxy.invoke_forge_action(
            {"name": "WindowGoldenRatio"},
            focus_window="leftmost",
            also_activate=True,
        )
        time.sleep(Timing.RESIZE_SETTLE)

        windows = window_helper.get_windows_sorted_by_position("x")
        left_w = windows[0]["rect"]["width"]
        right_w = windows[1]["rect"]["width"]
        combined = left_w + right_w
        assert combined > 0

        left_ratio = left_w / combined
        # Tolerance absorbs window gaps and integer pixel rounding.
        assert abs(left_ratio - GOLDEN) < 0.05, (
            f"focused (left) window should take ~{GOLDEN:.3f} of the row, "
            f"got {left_ratio:.3f} (left={left_w}, right={right_w})"
        )
