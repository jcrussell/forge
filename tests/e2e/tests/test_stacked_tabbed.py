"""
Stacked and Tabbed Layout Tests for Forge.

Tests stacked (Shift+Super+s) and tabbed (Shift+Super+t) layouts.
"""

import time

import pytest

from framework.constants import Timing, Tolerance
from framework.wait import wait_for_layout


def _layout_node_child_count(shell_proxy, layout):
    """Child count of the first container with the given layout (STACKED/TABBED), else -1.

    Walks shell_proxy.get_forge_tree(). Used to confirm a flat-monitor toggle wraps ONLY
    the focused window (single-child CON) rather than converting the whole monitor container.
    """

    def walk(node):
        if not isinstance(node, dict):
            return -1
        if node.get("layout") == layout:
            return len(node.get("children") or [])
        for child in node.get("children") or []:
            found = walk(child)
            if found >= 0:
                return found
        return -1

    return walk(shell_proxy.get_forge_tree())


@pytest.fixture(autouse=True)
def _enable_stacked_tabbed_modes(restore_settings):
    """Enable stacked + tabbed tiling for every test in this module.

    Both modes default to OFF in the gschema, so StackedLayoutToggle /
    TabbedLayoutToggle bail early (command.js) and toggle_stacked()/toggle_tabbed()
    are silent no-ops — which is why these tests historically accepted HSPLIT/NO_NODE
    and never actually exercised stacked/tabbed. restore_settings reverts after each
    test; the settle lets the GSetting reach Forge before the first toggle.
    """
    restore_settings.set_stacked_tiling_mode_enabled(True)
    restore_settings.set_tabbed_tiling_mode_enabled(True)
    time.sleep(Timing.SETTINGS_SETTLE)


class TestStackedLayout:
    """Test stacked layout functionality."""

    def test_toggle_stacked_mode(self, shell_proxy, input_sim, two_windows):
        """Shift+Super+s should toggle the container to STACKED."""
        input_sim.toggle_stacked()

        # The focused window's container must actually report STACKED (raises on
        # timeout). This is what forge-g14 + the disabled mode previously masked.
        wait_for_layout(shell_proxy, "STACKED")

        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Both windows should exist in stacked mode"

    def test_stacked_windows_valid(self, shell_proxy, input_sim, two_windows):
        """In stacked mode, windows should have valid dimensions."""
        input_sim.toggle_stacked()

        windows = shell_proxy.get_windows()
        for window in windows:
            rect = window.get("rect", {})
            assert rect.get("width", 0) > 0, "Window should have width"
            assert rect.get("height", 0) > 0, "Window should have height"

    def test_stacked_toggle_wraps_focused_window_only(self, shell_proxy, input_sim, two_windows):
        """Toggling stacked on a flat monitor wraps ONLY the focused window.

        On a flat monitor (both windows direct HSPLIT children) StackedLayoutToggle
        calls tree.split(focused, HORIZONTAL, forceSplit=True) (command.js), which pushes
        just the focused window into a new single-child CON (tree.js); the sibling stays
        under the monitor. The old test asserted only get_focused_window().wmClass
        truthiness — vacuous, since get_focused_window() auto-activates a window (forge-6d1).
        It also couldn't honestly test focus nav: a single-item CON has no in-stack sibling
        to move to (that multi-child case is covered by
        test_workflow_stacked.py::test_multi_window_stack_focus_moves).
        """
        input_sim.toggle_stacked()
        wait_for_layout(shell_proxy, "STACKED")

        assert shell_proxy.get_container_layout() == "STACKED"
        assert _layout_node_child_count(shell_proxy, "STACKED") == 1, (
            "toggle should wrap only the focused window in a single-child STACKED CON"
        )
        assert len(shell_proxy.get_windows()) >= 2, "the sibling window should still exist"

    def test_stacked_toggle_off(self, shell_proxy, input_sim, window_helper, two_windows):
        """Toggling stacked twice should restore normal layout."""
        window1, window2 = two_windows
        wm_class1 = window1.get("wmClass")

        rect_before = window_helper.get_window_rect(wm_class1)

        # Toggle stacked on then off
        input_sim.toggle_stacked()
        input_sim.toggle_stacked()

        rect_after = window_helper.get_window_rect(wm_class1)

        # Window should have valid dimensions
        assert rect_after[2] > 0, "Window should have width"
        assert rect_after[3] > 0, "Window should have height"


class TestTabbedLayout:
    """Test tabbed layout functionality."""

    def test_toggle_tabbed_mode(self, shell_proxy, input_sim, two_windows):
        """Shift+Super+t should toggle the container to TABBED."""
        input_sim.toggle_tabbed()

        # The focused window's container must actually report TABBED (raises on timeout).
        wait_for_layout(shell_proxy, "TABBED")

        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Both windows should exist in tabbed mode"

    def test_tabbed_windows_valid(self, shell_proxy, input_sim, two_windows):
        """In tabbed mode, windows should have valid dimensions."""
        input_sim.toggle_tabbed()

        windows = shell_proxy.get_windows()
        for window in windows:
            rect = window.get("rect", {})
            assert rect.get("width", 0) > 0, "Window should have width"
            assert rect.get("height", 0) > 0, "Window should have height"

    def test_tabbed_toggle_wraps_focused_window_only(self, shell_proxy, input_sim, two_windows):
        """Toggling tabbed on a flat monitor wraps ONLY the focused window.

        Same flat-monitor forceSplit behavior as the stacked case: TabbedLayoutToggle
        pushes just the focused window into a single-child TABBED CON, leaving the sibling
        under the monitor. The old test cycled focus_right 5x and only asserted that
        len(focused wmClasses) >= 1 — vacuous (focus_right in a single-item TABBED CON
        legitimately escapes to a monitor sibling, and one focused class always exists,
        forge-6d1). Cross-tab focus movement is covered by
        test_workflow_stacked.py::test_multi_window_stack_focus_moves.
        """
        input_sim.toggle_tabbed()
        wait_for_layout(shell_proxy, "TABBED")

        assert shell_proxy.get_container_layout() == "TABBED"
        assert _layout_node_child_count(shell_proxy, "TABBED") == 1, (
            "toggle should wrap only the focused window in a single-child TABBED CON"
        )
        assert len(shell_proxy.get_windows()) >= 2, "the sibling window should still exist"


class TestLayoutTransitions:
    """Test transitions between different layouts."""

    def test_hsplit_to_stacked_to_tabbed(self, shell_proxy, input_sim, two_windows):
        """Should transition between all layout types."""
        # Switch to stacked
        input_sim.toggle_stacked()
        wait_for_layout(shell_proxy, "STACKED")
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Windows should exist after stacked"

        # Switch to tabbed
        input_sim.toggle_tabbed()
        wait_for_layout(shell_proxy, "TABBED")
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Windows should exist after tabbed"

        # Switch back to split
        input_sim.toggle_layout()
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, "Windows should exist after layout toggle"

    def test_layout_changes_preserve_windows(self, shell_proxy, input_sim, three_windows):
        """All layout transitions should preserve window count."""
        initial_count = len(shell_proxy.get_windows())

        transitions = [
            input_sim.toggle_stacked,
            input_sim.toggle_tabbed,
            input_sim.toggle_layout,
            input_sim.split_vertical,
            input_sim.split_horizontal,
        ]

        for transition in transitions:
            transition()
            current_count = len(shell_proxy.get_windows())
            assert current_count == initial_count, (
                f"Window count changed from {initial_count} to {current_count}"
            )
