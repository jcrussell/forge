"""
Snap Layout Tests for Forge.

Tests preset snap positions (center, thirds) via D-Bus action invocation.
Uses invoke_forge_action() to bypass unreliable xdotool focus in Xvfb.
"""

import pytest

from framework.constants import Tolerance
from framework.wait import wait_for_stable


class TestSnapCenter:
    """Test snap-to-center behavior."""

    def test_snap_center_centers_window(
        self, shell_proxy, window_helper, test_window
    ):
        """SnapLayoutMove Center should center the window in the workspace."""
        wm_class = test_window.get("wmClass")

        # Snap to left third first to make window smaller than workspace
        # (Center preserves current dimensions, so a full-width tiled window stays full)
        shell_proxy.invoke_forge_action(
            {"name": "SnapLayoutMove", "direction": "Left", "amount": 0.333}
        )
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

        shell_proxy.invoke_forge_action(
            {"name": "SnapLayoutMove", "direction": "Center"}
        )
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

        rect = window_helper.get_window_rect(wm_class)
        workspace = window_helper.get_workspace_rect()

        window_center_x = rect[0] + rect[2] // 2
        workspace_center_x = workspace["x"] + workspace["width"] // 2

        assert abs(window_center_x - workspace_center_x) < Tolerance.CENTERING, (
            f"Window not centered: window center {window_center_x}, "
            f"workspace center {workspace_center_x}"
        )

        # Verify window is significantly smaller than workspace (not just tiled)
        assert rect[2] < workspace["width"] * 0.9, (
            f"Window width {rect[2]} should be significantly smaller than "
            f"workspace {workspace['width']} (ratio: {rect[2]/workspace['width']:.3f})"
        )


class TestSnapThirds:
    """Test snap-to-thirds positions."""

    @pytest.mark.parametrize(
        "action, expected_ratio, expected_edge",
        [
            ({"name": "SnapLayoutMove", "direction": "Left", "amount": 0.333}, 1 / 3, "left"),
            ({"name": "SnapLayoutMove", "direction": "Left", "amount": 0.667}, 2 / 3, "left"),
            ({"name": "SnapLayoutMove", "direction": "Right", "amount": 0.333}, 1 / 3, "right"),
            ({"name": "SnapLayoutMove", "direction": "Right", "amount": 0.667}, 2 / 3, "right"),
        ],
        ids=[
            "one_third_left",
            "two_third_left",
            "one_third_right",
            "two_third_right",
        ],
    )
    def test_snap_position(
        self,
        shell_proxy,
        window_helper,
        test_window,
        action,
        expected_ratio,
        expected_edge,
    ):
        """Snap action should position window at the expected ratio and edge."""
        wm_class = test_window.get("wmClass")

        shell_proxy.invoke_forge_action(action)
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

        rect = window_helper.get_window_rect(wm_class)
        workspace = window_helper.get_workspace_rect()

        # Check width ratio. forge-74p: the shared SNAP_RATIO (0.05) spans past the
        # 1/3 target on either side (0.283-0.383 for a 0.333 snap), so a snap that
        # overshoots by a sixth would still pass. The snap lands on a precise
        # fraction of the work area (only sub-pixel gap rounding moves it), so hold
        # it to a tighter band here.
        snap_tol = 0.025
        actual_ratio = rect[2] / workspace["width"]
        assert abs(actual_ratio - expected_ratio) < snap_tol, (
            f"Width ratio {actual_ratio:.3f} should be ~{expected_ratio:.3f}"
        )

        # Check edge alignment
        if expected_edge == "left":
            assert abs(rect[0] - workspace["x"]) < Tolerance.POSITION, (
                f"Window should be at left edge: x={rect[0]}, workspace x={workspace['x']}"
            )
        else:
            window_right = rect[0] + rect[2]
            workspace_right = workspace["x"] + workspace["width"]
            assert abs(window_right - workspace_right) < Tolerance.POSITION, (
                f"Window should be at right edge: right={window_right}, "
                f"workspace right={workspace_right}"
            )

        # Check height is approximately workspace height
        height_ratio = rect[3] / workspace["height"]
        assert height_ratio > Tolerance.FILL_RATIO, (
            f"Window height should be ~workspace height, ratio: {height_ratio:.3f}"
        )


class TestSnapTransitions:
    """Test transitioning between snap positions."""

    def test_snap_left_then_right(
        self, shell_proxy, window_helper, test_window
    ):
        """Snapping left then right should move the window."""
        wm_class = test_window.get("wmClass")

        shell_proxy.invoke_forge_action(
            {"name": "SnapLayoutMove", "direction": "Left", "amount": 0.333}
        )
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))
        rect_left = window_helper.get_window_rect(wm_class)

        shell_proxy.invoke_forge_action(
            {"name": "SnapLayoutMove", "direction": "Right", "amount": 0.333}
        )
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))
        rect_right = window_helper.get_window_rect(wm_class)

        # X position should have changed significantly
        assert abs(rect_right[0] - rect_left[0]) > Tolerance.CENTERING, (
            f"Window should have moved: x was {rect_left[0]}, now {rect_right[0]}"
        )
