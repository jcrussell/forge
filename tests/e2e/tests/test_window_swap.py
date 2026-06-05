"""
Window Swap Tests for Forge.

Tests window swapping with Ctrl+Super+h/j/k/l keys.
"""

import pytest

from framework.constants import Tolerance
from framework.wait import wait_for, wait_for_layout


class TestWindowSwap:
    """Test window swap functionality."""

    def test_swap_left_right(
        self, shell_proxy, input_sim, window_helper, dispatch_mode, two_windows
    ):
        """Ctrl+Super+h should physically move the focused window into the left slot.

        forge-y0d: the old assert only checked that *a* window was focused — always
        true. The fixtures launch same-class windows and get_windows() carries no
        id, so list order can't reveal a swap of identical windows; instead track
        the focused window by its stable id (Swap keeps focus on the moved window)
        and prove it relocated leftward.

        Pin the right window deterministically (last sibling of the HSPLIT) and
        settle, rather than seeding with focus-nav: a focus_right that hasn't reached
        Forge's focusMetaWindow yet let Swap act on a stale window and flaked on the
        slower older-version lanes (forge-gwo pattern).
        """
        pinned = shell_proxy.activate_last_sibling_of("HSPLIT")  # the right window
        assert "id" in pinned, f"could not pin the right window: {pinned!r}"
        shell_proxy.wait_for_idle()

        if dispatch_mode != "dbus":
            # Synthetic ctrl+super+h is unreliable under Mutter's VirtualInputDevice
            # (tile-snap latch, forge-er8); the keybinding lane only checks the
            # keypress->Forge path survives, not the swap geometry.
            input_sim.swap_left()
            assert isinstance(window_helper.get_focused_id(), int)
            return

        before = window_helper.get_focused_window()
        assert before["id"] == pinned["id"], "pin did not take"
        before_x = before["rect"]["x"]

        input_sim.swap_left()

        # Same window (by id) must now sit further left — the swap moved it.
        after = wait_for(
            window_helper.get_focused_window,
            predicate=lambda w: w.get("id") == before["id"]
            and w["rect"]["x"] < before_x - Tolerance.POSITION,
            message=f"swap_left did not move the focused window left (x stayed ~{before_x})",
        )
        assert after["rect"]["x"] < before_x

    def test_swap_preserves_window_count(self, shell_proxy, input_sim, two_windows):
        """Swapping should not change the number of windows."""
        count_before = len(shell_proxy.get_windows())

        input_sim.swap_left()
        input_sim.swap_right()

        count_after = len(shell_proxy.get_windows())
        assert count_before == count_after, (
            f"Window count changed from {count_before} to {count_after}"
        )

    def test_swap_up_down_in_vsplit(
        self, shell_proxy, input_sim, window_helper, dispatch_mode, two_windows
    ):
        """Ctrl+Super+k should physically move the focused window up in a VSPLIT.

        forge-y0d: the old assert only checked width/height > 0 after the swap.
        Toggle to a vertical split, pin the BOTTOM window deterministically (last
        sibling of the VSPLIT) and settle, then prove that same window (by id) moves
        above where it started. Pinning + wait_for_idle avoids the focus-seed race
        that flaked the older-version lanes.
        """
        input_sim.toggle_layout()
        wait_for_layout(shell_proxy, "VSPLIT")  # the HSPLIT->VSPLIT toggle settled

        pinned = shell_proxy.activate_last_sibling_of("VSPLIT")  # the bottom window
        assert "id" in pinned, f"could not pin the bottom window: {pinned!r}"
        shell_proxy.wait_for_idle()

        if dispatch_mode != "dbus":
            # Synthetic ctrl+super+k is unreliable under VirtualInputDevice (forge-er8);
            # the keybinding lane only checks the keypress->Forge path survives.
            input_sim.swap_up()
            assert isinstance(window_helper.get_focused_id(), int)
            return

        before = window_helper.get_focused_window()
        assert before["id"] == pinned["id"], "pin did not take"
        before_y = before["rect"]["y"]

        input_sim.swap_up()

        after = wait_for(
            window_helper.get_focused_window,
            predicate=lambda w: w.get("id") == before["id"]
            and w["rect"]["y"] < before_y - Tolerance.POSITION,
            message=f"swap_up did not move the focused window up (y stayed ~{before_y})",
        )
        assert after["rect"]["y"] < before_y

    def test_swap_single_window_no_effect(self, shell_proxy, input_sim, window_helper, test_window):
        """Swapping with single window should have no effect."""
        wm_class = test_window.get("wmClass")
        rect_before = window_helper.get_window_rect(wm_class)

        # Try all swap directions
        input_sim.swap_left()
        input_sim.swap_right()
        input_sim.swap_up()
        input_sim.swap_down()

        rect_after = window_helper.get_window_rect(wm_class)

        # Position should be unchanged
        assert abs(rect_before[0] - rect_after[0]) < Tolerance.POSITION, "X position changed"
        assert abs(rect_before[1] - rect_after[1]) < Tolerance.POSITION, "Y position changed"
        assert abs(rect_before[2] - rect_after[2]) < Tolerance.POSITION, "Width changed"
        assert abs(rect_before[3] - rect_after[3]) < Tolerance.POSITION, "Height changed"


class TestWindowMove:
    """Test window move to container functionality."""

    def test_move_relocates_focused_window(
        self, shell_proxy, input_sim, window_helper, dispatch_mode, two_windows
    ):
        """Shift+Super+h should re-place the focused window within the layout.

        forge-y0d: the old assert only checked count >= 2 — true before the move
        too. On a flat single-monitor layout Move reorders the window inside the
        monitor container (it does not create a nested container headless), so the
        user-visible effect is the focused window changing slots. Pin the RIGHT
        window deterministically (last sibling of the HSPLIT) and settle, then
        Move-Left re-places it into the left slot (tree.move swaps with the left
        neighbour). Track by stable id so the identical-window fixture can't mask a
        no-op. (Move-Down on the last child is a genuine no-op — nowhere to go — so
        a direction with a neighbour is required.)
        """
        pinned = shell_proxy.activate_last_sibling_of("HSPLIT")  # the right window
        assert "id" in pinned, f"could not pin the right window: {pinned!r}"
        shell_proxy.wait_for_idle()

        if dispatch_mode != "dbus":
            # Synthetic shift+super+h is unreliable under VirtualInputDevice (forge-er8).
            input_sim.move_left()
            assert len(shell_proxy.get_windows()) >= 2
            return

        before = window_helper.get_focused_window()
        assert before["id"] == pinned["id"], "pin did not take"
        before_x = before["rect"]["x"]

        input_sim.move_left()

        after = wait_for(
            window_helper.get_focused_window,
            predicate=lambda w: w.get("id") == before["id"]
            and w["rect"]["x"] < before_x - Tolerance.POSITION,
            message=f"move_left did not relocate the focused window left (x stayed ~{before_x})",
        )
        assert after["rect"]["x"] < before_x
        assert len(shell_proxy.get_windows()) >= 2, "both windows should survive the move"

    def test_move_preserves_window_count(self, shell_proxy, input_sim, three_windows):
        """Moving windows should preserve window count."""
        count_before = len(shell_proxy.get_windows())

        input_sim.move_left()
        input_sim.move_right()
        input_sim.move_up()
        input_sim.move_down()

        count_after = len(shell_proxy.get_windows())
        assert count_before == count_after, (
            f"Window count changed from {count_before} to {count_after}"
        )
