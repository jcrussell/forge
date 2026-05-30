"""
Float Toggle Tests for Forge.

Tests floating window mode toggle with Super+c.
"""

import time

import pytest

from framework.constants import Timing, Tolerance
from framework.wait import wait_for, wait_for_stable


class TestFloatToggle:
    """Test floating mode toggle functionality."""

    def test_toggle_float_single_window(self, shell_proxy, input_sim, window_helper, test_window):
        """FloatToggle should toggle window between tiled and floating."""
        wm_class = test_window.get("wmClass")
        workspace = window_helper.get_workspace_rect()

        # Verify window fills workspace (tiled)
        rect_before = window_helper.get_window_rect(wm_class)
        assert rect_before[2] > workspace["width"] * 0.9, (
            "Initial window should fill workspace width"
        )

        # Toggle to floating via D-Bus (xdotool focus unreliable in Xvfb)
        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({
            "name": "FloatToggle",
            "x": "center",
            "y": "center",
            "width": 0.65,
            "height": 0.75,
        })
        # Poll until the float resize settles instead of a fixed sleep.
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

        # Floating window should be smaller (default 65% x 75%)
        rect_after = window_helper.get_window_rect(wm_class)
        expected_width = int(workspace["width"] * 0.65)
        expected_height = int(workspace["height"] * 0.75)

        assert abs(rect_after[2] - expected_width) < Tolerance.CENTERING, (
            f"Floating width {rect_after[2]} should be ~{expected_width}"
        )
        assert abs(rect_after[3] - expected_height) < Tolerance.CENTERING, (
            f"Floating height {rect_after[3]} should be ~{expected_height}"
        )

    def test_toggle_float_then_tile(self, shell_proxy, input_sim, window_helper, test_window):
        """Toggling float twice should restore tiled state."""
        wm_class = test_window.get("wmClass")
        rect_initial = window_helper.get_window_rect(wm_class)

        # Toggle to float then back to tiled
        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({"name": "FloatToggle"})
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({"name": "FloatToggle"})
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

        rect_final = window_helper.get_window_rect(wm_class)

        assert abs(rect_initial[2] - rect_final[2]) < Tolerance.ALIGNMENT, (
            f"Width should be restored: {rect_initial[2]} vs {rect_final[2]}"
        )
        assert abs(rect_initial[3] - rect_final[3]) < Tolerance.ALIGNMENT, (
            f"Height should be restored: {rect_initial[3]} vs {rect_final[3]}"
        )

    def test_float_window_centered(self, shell_proxy, input_sim, window_helper, test_window):
        """Floating window should be centered in workspace."""
        wm_class = test_window.get("wmClass")

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({"name": "FloatToggle"})
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

        rect = window_helper.get_window_rect(wm_class)
        workspace = window_helper.get_workspace_rect()

        # Calculate center positions
        window_center_x = rect[0] + rect[2] // 2
        window_center_y = rect[1] + rect[3] // 2
        workspace_center_x = workspace["x"] + workspace["width"] // 2
        workspace_center_y = workspace["y"] + workspace["height"] // 2

        assert abs(window_center_x - workspace_center_x) < Tolerance.CENTERING, (
            f"Window not centered horizontally: {window_center_x} vs {workspace_center_x}"
        )
        assert abs(window_center_y - workspace_center_y) < Tolerance.CENTERING, (
            f"Window not centered vertically: {window_center_y} vs {workspace_center_y}"
        )


class TestFloatWithMultipleWindows:
    """Test floating behavior with multiple windows."""

    def test_float_one_of_two(self, shell_proxy, input_sim, window_helper, two_windows):
        """Floating one window should make the other fill available space."""
        workspace = window_helper.get_workspace_rect()

        # Use D-Bus action (xdotool focus unreliable in Xvfb)
        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({"name": "FloatToggle"})

        # Poll until a window has expanded to fill the freed space.
        def has_large_window(windows):
            return isinstance(windows, list) and any(
                w.get("rect", {}).get("width", 0) > workspace["width"] * 0.8 for w in windows
            )

        windows = wait_for(
            shell_proxy.get_windows,
            predicate=has_large_window,
            message="Remaining tiled window did not fill workspace",
        )
        assert has_large_window(windows), "Remaining tiled window should fill workspace"

    def test_float_preserves_other_windows(self, shell_proxy, input_sim, two_windows):
        """Floating a window should not affect other window count."""
        count_before = len(shell_proxy.get_windows())

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({"name": "FloatToggle"})
        # fixed: count-preservation has no positive post-condition to poll (count is
        # unchanged by design); brief settle lets any erroneous create/destroy surface.
        time.sleep(Timing.LAYOUT_CHANGE)

        count_after = len(shell_proxy.get_windows())
        assert count_before == count_after, (
            f"Window count changed from {count_before} to {count_after}"
        )

    def test_focus_floated_window(self, shell_proxy, input_sim, two_windows):
        """Should be able to focus a floating window."""
        focused_before = shell_proxy.get_focused_window()
        focused_class = focused_before.get("wmClass")

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({"name": "FloatToggle"})
        # Poll until the FOCUSED window reports floating. Use the identity-based
        # check, not is_window_floating(focused_class): with two same-class windows
        # the class lookup is first-match and may inspect the still-tiled window.
        wait_for(shell_proxy.is_focused_window_floating, predicate=bool)

        # Focus should still be on the same window
        focused_after = shell_proxy.get_focused_window()
        assert focused_after.get("wmClass") == focused_class, (
            "Focus should remain on floated window"
        )

        # Navigate away and back
        input_sim.focus_left()
        input_sim.focus_right()

        focused_final = shell_proxy.get_focused_window()
        assert focused_final.get("wmClass"), "Should have a focused window"
