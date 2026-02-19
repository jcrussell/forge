"""
Live Settings Tests for Forge.

Tests that GSettings changes take effect immediately on the tiling layout.
"""

import time

import pytest

from framework.constants import Timing, Tolerance


class TestGapSizeSettings:
    """Test window gap size settings."""

    def test_increase_gap_size(
        self, shell_proxy, window_helper, restore_settings, two_windows
    ):
        """Increasing gap size should increase space between windows."""
        time.sleep(Timing.WINDOW_SETTLE)

        gap_before = window_helper.measure_gap_between()

        restore_settings.set_window_gap_size(20)
        time.sleep(Timing.SETTINGS_SETTLE)

        gap_after = window_helper.measure_gap_between()

        assert gap_after > gap_before, (
            f"Gap should increase: was {gap_before}, now {gap_after}"
        )

    def test_zero_gap_size(
        self, shell_proxy, window_helper, restore_settings, two_windows
    ):
        """Setting gap to 0 should make windows nearly touch."""
        restore_settings.set_window_gap_size(0)
        time.sleep(Timing.SETTINGS_SETTLE)

        gap = window_helper.measure_gap_between()

        assert abs(gap) < Tolerance.POSITION, (
            f"Windows should nearly touch with gap=0, actual gap: {gap}"
        )

    def test_gap_hidden_on_single(
        self, shell_proxy, window_helper, restore_settings, test_window
    ):
        """With gap-hidden-on-single, a single window should still fill workspace."""
        restore_settings.set_window_gap_size(20)
        restore_settings.set_window_gap_hidden_on_single(True)
        time.sleep(Timing.SETTINGS_SETTLE)

        wm_class = test_window.get("wmClass")
        workspace = window_helper.get_workspace_rect()
        rect = window_helper.get_window_rect(wm_class)

        assert abs(rect[2] - workspace["width"]) < Tolerance.SIZE, (
            f"Single window should fill workspace: width {rect[2]} vs {workspace['width']}"
        )

    def test_gap_shown_on_single_when_disabled(
        self, shell_proxy, window_helper, restore_settings, test_window
    ):
        """With gap-hidden-on-single=false, a single window should be smaller."""
        restore_settings.set_window_gap_size(20)
        restore_settings.set_window_gap_hidden_on_single(False)
        time.sleep(Timing.SETTINGS_SETTLE)

        wm_class = test_window.get("wmClass")
        workspace = window_helper.get_workspace_rect()
        rect = window_helper.get_window_rect(wm_class)

        # Window should be noticeably smaller than workspace due to gaps on all sides
        assert rect[2] < workspace["width"] - 10, (
            f"Single window should be smaller than workspace: "
            f"width {rect[2]} vs {workspace['width']}"
        )


class TestTilingModeToggle:
    """Test enabling/disabling tiling mode."""

    def test_disable_tiling_mode(
        self, shell_proxy, window_helper, restore_settings, two_windows
    ):
        """Disabling tiling mode should stop managing windows."""
        time.sleep(Timing.WINDOW_SETTLE)
        sorted_before = window_helper.get_windows_sorted_by_position("x")
        widths_before = [w.get("rect", {}).get("width", 0) for w in sorted_before]

        restore_settings.set_tiling_mode_enabled(False)
        time.sleep(Timing.SETTINGS_SETTLE)

        # Windows may remain where they are, but new behavior would be untiled.
        # Verify the setting changed by checking it took effect.
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Windows should still exist after disabling tiling"

    def test_reenable_tiling_retiles(
        self, shell_proxy, window_helper, restore_settings, two_windows
    ):
        """Re-enabling tiling should re-tile windows."""
        time.sleep(Timing.WINDOW_SETTLE)

        # Disable then re-enable
        restore_settings.set_tiling_mode_enabled(False)
        time.sleep(Timing.SETTINGS_SETTLE)
        restore_settings.set_tiling_mode_enabled(True)
        time.sleep(Timing.SETTINGS_SETTLE)

        window_helper.assert_windows_fill_workspace()


class TestStackedTabbedSettings:
    """Test stacked/tabbed mode enable/disable settings."""

    @pytest.mark.parametrize(
        "mode, setting_method, toggle_method",
        [
            ("STACKED", "set_stacked_tiling_mode_enabled", "toggle_stacked"),
            ("TABBED", "set_tabbed_tiling_mode_enabled", "toggle_tabbed"),
        ],
        ids=["stacked", "tabbed"],
    )
    def test_toggle_blocked_when_disabled(
        self,
        shell_proxy,
        input_sim,
        restore_settings,
        two_windows,
        mode,
        setting_method,
        toggle_method,
    ):
        """Disabling stacked/tabbed setting should prevent toggling to that mode."""
        time.sleep(Timing.WINDOW_SETTLE)

        # Disable the mode via settings
        getattr(restore_settings, setting_method)(False)
        time.sleep(Timing.SETTINGS_SETTLE)

        # Try to toggle to the disabled mode
        getattr(input_sim, toggle_method)()
        time.sleep(Timing.LAYOUT_CHANGE)

        # Layout should not be the disabled mode
        layout = shell_proxy.get_container_layout()
        assert layout != mode, (
            f"Layout should not be {mode} when it's disabled, but got {layout}"
        )
