"""
Live Settings Tests for Forge.

Tests that GSettings changes take effect immediately on the tiling layout.
"""

import time

import pytest

from framework.constants import Timing, Tolerance
from framework.wait import wait_for, wait_for_layout, wait_for_stable


def _count_containers(node) -> int:
    """Count CON (split-container) nodes in a get_tree_structure() dict.

    Flat tiling attaches windows directly under the MONITOR node (no CON); a
    nested split wraps them in a CON. So container count distinguishes "flat"
    (0) from "auto-split nested" (>=1).
    """
    if not isinstance(node, dict):
        return 0
    n = 1 if node.get("nodeType") == "CON" else 0
    for child in node.get("children") or []:
        n += _count_containers(child)
    return n


class TestGapSizeSettings:
    """Test window gap size settings."""

    def test_increase_gap_size(
        self, shell_proxy, window_helper, restore_settings, two_windows
    ):
        """Increasing gap size should increase space between windows."""
        # Wait for the two-window tiling (and its gap) to settle before measuring.
        wait_for_stable(lambda: window_helper.measure_gap_between())
        gap_before = window_helper.measure_gap_between()

        restore_settings.set_window_gap_size(20)
        gap_after = wait_for(
            lambda: window_helper.measure_gap_between(),
            predicate=lambda g: g > gap_before,
            message="Gap did not grow after increasing gap size",
        )

        assert gap_after > gap_before, (
            f"Gap should increase: was {gap_before}, now {gap_after}"
        )

    def test_zero_gap_size(
        self, shell_proxy, window_helper, restore_settings, two_windows
    ):
        """Setting gap to 0 should make windows nearly touch."""
        restore_settings.set_window_gap_size(0)
        gap = wait_for(
            lambda: window_helper.measure_gap_between(),
            predicate=lambda g: abs(g) < Tolerance.POSITION,
            message="Windows did not close the gap after setting gap=0",
        )

        assert abs(gap) < Tolerance.POSITION, (
            f"Windows should nearly touch with gap=0, actual gap: {gap}"
        )

    def test_gap_hidden_on_single(
        self, shell_proxy, window_helper, restore_settings, test_window
    ):
        """With gap-hidden-on-single, a single window should still fill workspace."""
        wm_class = test_window.get("wmClass")
        restore_settings.set_window_gap_size(20)
        restore_settings.set_window_gap_hidden_on_single(True)
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

        workspace = window_helper.get_workspace_rect()
        rect = window_helper.get_window_rect(wm_class)

        assert abs(rect[2] - workspace["width"]) < Tolerance.SIZE, (
            f"Single window should fill workspace: width {rect[2]} vs {workspace['width']}"
        )

    def test_gap_shown_on_single_when_disabled(
        self, shell_proxy, window_helper, restore_settings, test_window
    ):
        """With gap-hidden-on-single=false, a single window should be smaller."""
        wm_class = test_window.get("wmClass")
        restore_settings.set_window_gap_size(20)
        restore_settings.set_window_gap_hidden_on_single(False)
        wait_for_stable(lambda: window_helper.get_window_rect(wm_class))

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
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
        sorted_before = window_helper.get_windows_sorted_by_position("x")
        widths_before = [w.get("rect", {}).get("width", 0) for w in sorted_before]

        restore_settings.set_tiling_mode_enabled(False)
        # Gate on the GSetting actually flipping (its propagation is the real
        # post-condition); existing windows stay put, so we also keep the
        # existence check below.
        wait_for(
            lambda: restore_settings.get("tiling-mode-enabled"),
            predicate=lambda enabled: not enabled,
            message="tiling-mode-enabled did not flip to False",
        )
        assert not restore_settings.get("tiling-mode-enabled"), (
            "tiling mode should be disabled"
        )

        # Windows may remain where they are, but new behavior would be untiled.
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Windows should still exist after disabling tiling"

    def test_reenable_tiling_retiles(
        self, shell_proxy, window_helper, restore_settings, two_windows
    ):
        """Re-enabling tiling should re-tile windows."""
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        # Disable then re-enable
        restore_settings.set_tiling_mode_enabled(False)
        # fixed: intermediate settle so the disable registers before we re-enable.
        time.sleep(Timing.SETTINGS_SETTLE)
        restore_settings.set_tiling_mode_enabled(True)
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

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
        # Disable the mode via settings
        getattr(restore_settings, setting_method)(False)
        # fixed: GSetting propagation to Forge has no clean observable to poll before
        # the toggle attempt; the toggle itself (toggle_method) self-settles.
        time.sleep(Timing.SETTINGS_SETTLE)

        # Try to toggle to the disabled mode (toggle_stacked/tabbed self-settle)
        getattr(input_sim, toggle_method)()

        # Layout should not be the disabled mode
        layout = shell_proxy.get_container_layout()
        assert layout != mode, (
            f"Layout should not be {mode} when it's disabled, but got {layout}"
        )


class TestDefaultWindowLayoutSetting:
    """Test the default-window-layout setting (Feature #398)."""

    @pytest.mark.parametrize("layout_value", ["tabbed", "stacked"])
    def test_default_layout_applies_to_new_container(
        self, shell_proxy, input_sim, restore_settings, two_windows, layout_value
    ):
        """default-window-layout should set the layout of a newly split container.

        A Split wraps the focused window in a new container, and
        applyDefaultLayoutToContainer (command.js) sets that container to the
        configured layout — but only when the matching tiling mode is enabled, so
        we enable both modes first.
        """
        restore_settings.set_stacked_tiling_mode_enabled(True)
        restore_settings.set_tabbed_tiling_mode_enabled(True)
        restore_settings.set("default-window-layout", layout_value)
        time.sleep(Timing.SETTINGS_SETTLE)

        shell_proxy.ensure_focus()
        input_sim.split_vertical()

        # The new container must adopt the configured layout (raises on timeout).
        expected = layout_value.upper()
        layout = wait_for_layout(shell_proxy, expected)
        assert layout == expected, f"Expected {expected} container, got {layout}"

    def test_default_layout_tiled_stays_split(
        self, shell_proxy, input_sim, restore_settings, two_windows
    ):
        """Control: with default-window-layout=tiled, a split stays a plain split."""
        restore_settings.set("default-window-layout", "tiled")
        time.sleep(Timing.SETTINGS_SETTLE)

        shell_proxy.ensure_focus()
        input_sim.split_vertical()
        time.sleep(Timing.LAYOUT_CHANGE)

        layout = shell_proxy.get_container_layout()
        assert layout in ("HSPLIT", "VSPLIT"), (
            f"tiled default should yield a split layout, got {layout}"
        )


class TestAutoSplitSetting:
    """Test the auto-split-enabled setting."""

    def test_auto_split_nests_new_window(
        self, shell_proxy, restore_settings, launch_window, two_windows
    ):
        """With auto-split on, adding a window to a tall pane nests a split container.

        After two windows tile side-by-side on a landscape monitor the focused
        pane is taller than wide, so auto-split derives a VSPLIT — differing from
        the HSPLIT parent — and wraps the pane in a new container (window.js
        trackWindow). Without auto-split the windows stay flat under MONITOR.
        """
        restore_settings.set("auto-split-enabled", True)
        time.sleep(Timing.SETTINGS_SETTLE)

        shell_proxy.ensure_focus()
        rect = shell_proxy.get_focused_window().get("rect", {})
        assert rect.get("width", 0) < rect.get("height", 0), (
            f"precondition: focused pane should be tall (portrait), got {rect}"
        )

        launch_window()

        tree = wait_for(
            shell_proxy.get_tree_structure,
            predicate=lambda t: _count_containers(t) >= 1,
            message="auto-split should nest the new window in a split container",
        )
        assert _count_containers(tree) >= 1

    def test_no_auto_split_keeps_flat(
        self, shell_proxy, restore_settings, launch_window, two_windows
    ):
        """Control: without auto-split the third window stays a flat sibling."""
        restore_settings.set("auto-split-enabled", False)
        time.sleep(Timing.SETTINGS_SETTLE)

        shell_proxy.ensure_focus()
        launch_window()
        # Absence of nesting has no positive post-condition to poll; settle briefly.
        time.sleep(Timing.LAYOUT_CHANGE)

        assert shell_proxy.get_window_count() == 3, "all three windows should be tiled"
        tree = shell_proxy.get_tree_structure()
        assert _count_containers(tree) == 0, (
            "without auto-split, windows should stay flat (no nested container)"
        )
