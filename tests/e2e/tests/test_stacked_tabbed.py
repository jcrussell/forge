"""
Stacked and Tabbed Layout Tests for Forge.

Tests stacked (Shift+Super+s) and tabbed (Shift+Super+t) layouts.
"""

import time

import pytest

from framework.constants import Timing, Tolerance
from framework.wait import wait_for_layout


def _assert_windows_within_workspace(shell_proxy):
    """Every tiled window sits within the workspace bounds (real geometry, not just >0).

    forge-izt: 'valid dimensions' must mean on-screen and inside the work area —
    a regression that pushed a stacked/tabbed window off-screen or to a zero size
    would slip past a bare width/height > 0 check. Same-class windows + id-less
    get_windows() mean we iterate rects directly rather than look up by wmClass.
    """
    ws = shell_proxy.get_workspace_rect()
    windows = shell_proxy.get_windows()
    assert len(windows) >= 2, "both windows should survive the toggle"
    for w in windows:
        r = w.get("rect", {})
        assert r.get("width", 0) > 0 and r.get("height", 0) > 0, f"window collapsed: {r}"
        assert r["x"] >= ws["x"] - Tolerance.POSITION, f"window left of workspace: {r} vs {ws}"
        assert r["y"] >= ws["y"] - Tolerance.POSITION, f"window above workspace: {r} vs {ws}"
        assert r["x"] + r["width"] <= ws["x"] + ws["width"] + Tolerance.SIZE, (
            f"window past workspace right edge: {r} vs {ws}"
        )
        assert r["y"] + r["height"] <= ws["y"] + ws["height"] + Tolerance.SIZE, (
            f"window past workspace bottom edge: {r} vs {ws}"
        )


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
        """Toggling stacked must produce a STACKED container with on-screen windows.

        forge-izt: the old assert (width/height > 0) passed even when the toggle
        was a silent no-op. The toggle's effect is the layout type (on a flat
        2-window monitor the focused window is wrapped into a single-child STACKED
        CON, so its geometry is otherwise unchanged — see
        test_stacked_toggle_wraps_focused_window_only), so wait_for_layout is the
        real 'it changed' assertion; the geometry check guards that neither window
        was lost or pushed off-screen.
        """
        input_sim.toggle_stacked()
        wait_for_layout(shell_proxy, "STACKED")
        _assert_windows_within_workspace(shell_proxy)

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
        """Toggling tabbed must produce a TABBED container with on-screen windows.

        forge-izt: same upgrade as test_stacked_windows_valid — wait_for_layout is
        the real 'the toggle took effect' assertion (the focused window is wrapped
        into a single-child TABBED CON on a flat monitor), and the geometry check
        guards that neither window was lost or pushed off-screen.
        """
        input_sim.toggle_tabbed()
        wait_for_layout(shell_proxy, "TABBED")
        _assert_windows_within_workspace(shell_proxy)

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


# forge-37r: deterministically focus a WINDOW whose parent CON also has a CON
# child, so toggling tabbed produces a TABBED container with a nested split-con
# child (the case that previously threw on the CON's missing actor.border).
_FOCUS_WINDOW_SIBLING_OF_CON = """
(() => {
  const ext = Main.extensionManager.lookup('forge@jmmaranan.com').stateObj;
  const tree = ext && ext.extWm && ext.extWm.tree;
  if (!tree) return 'no-tree';
  let target = null;
  const walk = (n) => {
    if (!n || target) return;
    const kids = n.childNodes || [];
    if (n.nodeType === 'CON' &&
        kids.some(c => c.nodeType === 'CON') &&
        kids.some(c => c.nodeType === 'WINDOW')) {
      target = kids.find(c => c.nodeType === 'WINDOW');
      return;
    }
    kids.forEach(walk);
  };
  walk(tree);
  if (target && target.nodeValue) {
    target.nodeValue.activate(global.get_current_time());
    return 'activated';
  }
  return 'no-target';
})()
"""


def _tabbed_con_child_window_counts(shell_proxy):
    """Per CON child of any TABBED node, count its WINDOW descendants.

    A nested split preserved as one tab item (forge-37r) appears as a CON child
    of a TABBED node; flattening would instead put those windows directly under
    the TABBED node, leaving it with no CON child.
    """

    def count_windows(node):
        if not isinstance(node, dict):
            return 0
        n = 1 if node.get("nodeType") == "WINDOW" else 0
        for c in node.get("children") or []:
            n += count_windows(c)
        return n

    counts = []

    def walk(node):
        if not isinstance(node, dict):
            return
        children = node.get("children") or []
        if node.get("layout") == "TABBED":
            for c in children:
                if c.get("nodeType") == "CON":
                    counts.append(count_windows(c))
        for c in children:
            walk(c)

    walk(shell_proxy.get_forge_tree())
    return counts


class TestTabbedNestedSplitCon:
    """forge-37r (bug #57): a tabbed container with a nested split-con sibling.

    Builds  CON[ window, conSplit[ window, window ] ]  and tabs that CON, so the
    renderer must draw the nested split container as a single header tab. The old
    code threw on the CON child's missing actor.border; this guards that the real
    shell renders it without crashing and keeps the nested split intact.
    """

    def test_tabbed_parent_with_nested_split_con(
        self, shell_proxy, input_sim, two_windows, launch_window
    ):
        # Build CON[wA, conH[wB, wC]] nested under the monitor.
        input_sim.split_vertical()  # nest the focused window into a VSPLIT con
        launch_window()  # -> conV[wA, wB]
        input_sim.split_horizontal()  # split focused wB -> conV[wA, conH[wB]]
        launch_window()  # -> conH[wB, wC]
        assert len(shell_proxy.get_windows()) == 4, "expected four windows before tabbing"

        # Deterministically focus the window sibling of the nested con, then tab.
        assert shell_proxy.eval(_FOCUS_WINDOW_SIBLING_OF_CON) == "activated"
        time.sleep(Timing.LAYOUT_CHANGE)
        input_sim.toggle_tabbed()
        time.sleep(Timing.STACKED_LAYOUT_CHANGE)

        # Shell must still be alive and the tree queryable (no render crash).
        tree = shell_proxy.get_forge_tree()
        assert isinstance(tree, dict) and "error" not in tree, (
            f"tree unavailable after tabbing nested split-con: {tree}"
        )

        # All four windows survive with valid on-screen geometry.
        _assert_windows_within_workspace(shell_proxy)
        assert len(shell_proxy.get_windows()) == 4, "windows lost after tabbing nested split-con"

        # The nested split-con is preserved as one tab item: a CON child of a
        # TABBED node still holding both of its windows (not flattened).
        counts = _tabbed_con_child_window_counts(shell_proxy)
        assert counts, "no TABBED node has a CON child (nested split was flattened)"
        assert any(c >= 2 for c in counts), (
            f"nested split-con did not keep its windows as one tab item; counts={counts}"
        )
