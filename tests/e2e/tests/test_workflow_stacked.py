"""
Workflow WF4: stacked / tabbed + focus workflow (forge-911 / forge-clp).

Drives one 3-window set through HSPLIT -> STACKED -> TABBED -> close -> split,
with focus navigation, asserting at each step. Folds the stacked/tabbed layout,
focus-within-stack and tree-integrity-in-stacked atomic concerns into a single
launch — and crucially amortizes the heavy STACKED_LAYOUT_CHANGE (~3s) settle,
paid a handful of times here instead of once per atomic stacked/tabbed test.

Determinism: in STACKED/TABBED all children share one rect, so a positional
focus_window hint can't disambiguate them. This workflow targets via focus
ACTIONS and asserts on layout/path (get_container_layout, get_focused_node_path),
never positional geometry.
"""

import time

import pytest

from framework.constants import Timing
from framework.wait import wait_for_layout, wait_for_window_count
from framework.workflow import step


def _layout_node_child_count(shell_proxy, layout):
    """Child count of the first container with the given layout (STACKED/TABBED), else -1.

    Used to confirm a genuine MULTI-child stacked/tabbed container was built before asserting
    cross-sibling focus nav — otherwise the test could silently regress to the single-item
    container case (which has no sibling to move to) and pass vacuously.
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
    """Enable stacked + tabbed tiling for this module.

    Both modes default OFF in the gschema, so LayoutStackedToggle /
    LayoutTabbedToggle bail early and the toggles are silent no-ops otherwise.
    restore_settings reverts after the test; the settle lets the GSetting reach
    Forge before the first toggle (mirrors test_stacked_tabbed.py).
    """
    restore_settings.set_stacked_tiling_mode_enabled(True)
    restore_settings.set_tabbed_tiling_mode_enabled(True)
    time.sleep(Timing.SETTINGS_SETTLE)


class TestWorkflowStacked:
    """One three-window set, sequenced through stacked/tabbed layouts + focus nav."""

    def test_stacked_tabbed_focus(
        self, shell_proxy, input_sim, window_helper, three_windows
    ):
        with step(shell_proxy, "three windows tiled"):
            wait_for_window_count(shell_proxy, 3)

        with step(shell_proxy, "toggle STACKED -> container reports STACKED, 3 windows"):
            input_sim.toggle_stacked()  # self-settles: STACKED_LAYOUT_CHANGE + wait_for_idle
            wait_for_layout(shell_proxy, "STACKED")
            assert len(shell_proxy.get_windows()) == 3

        with step(shell_proxy, "navigate the stacked container -> focus stays valid & contained"):
            # Forge's stacked toggle on a flat monitor wraps ONLY the focused
            # window in a new single-item STACKED container (command.js
            # LayoutStackedToggle splits the window off when its parent is the
            # monitor), so there is no sibling to move to. The honest, non-vacuous
            # check (forge-gwo) is that focus_down/up keep focus on a real window
            # still inside a STACKED container — navigation must not drop focus or
            # collapse the layout. (The old assert only checked wmClass truthiness,
            # which get_focused_window auto-activation satisfies unconditionally.)
            input_sim.focus_down()
            assert isinstance(window_helper.get_focused_id(), int)
            assert shell_proxy.get_container_layout() == "STACKED"
            input_sim.focus_up()
            assert isinstance(window_helper.get_focused_id(), int)
            assert shell_proxy.get_container_layout() == "STACKED"

        with step(shell_proxy, "toggle TABBED -> container reports TABBED, 3 windows"):
            input_sim.toggle_tabbed()  # self-settles
            wait_for_layout(shell_proxy, "TABBED")
            assert len(shell_proxy.get_windows()) == 3

        with step(shell_proxy, "navigate the tabbed container -> focus stays valid & contained"):
            # Same single-item-container reality as the stacked step above (the
            # tabbed toggle wraps ONLY the focused window), so the TABBED CON is one
            # child of the monitor's HSPLIT, beside the other windows. Use VERTICAL
            # nav here, mirroring the stacked step: focus_down/up cannot escape the
            # horizontally-laid-out monitor, so focus stays on the wrapped window and
            # the container stays TABBED. HORIZONTAL nav (focus_right) would instead
            # bubble up the single-item CON to the monitor and legitimately move to a
            # sibling (correct i3/sway behavior) — get_container_layout then reports
            # the monitor's HSPLIT, so it cannot assert layout stability. (Genuine
            # multi-window tab cycling is the deferred follow-up noted in 6909d4b.)
            input_sim.focus_down()
            assert isinstance(window_helper.get_focused_id(), int)
            assert shell_proxy.get_container_layout() == "TABBED"
            # forge-gwo: assert a non-empty LIST — get_focused_node_path returns a
            # truthy {error:...} dict on failure, so bare truthiness was vacuous (it
            # passed even when the path did not resolve).
            path = shell_proxy.get_focused_node_path()
            assert isinstance(path, list) and len(path) > 0, (
                f"focused node path should resolve to a tab, got {path!r}"
            )
            input_sim.focus_up()
            assert isinstance(window_helper.get_focused_id(), int)
            assert shell_proxy.get_container_layout() == "TABBED"

        with step(shell_proxy, "close one in TABBED -> tree stays valid, 2 windows"):
            shell_proxy.close_one_window()
            wait_for_window_count(shell_proxy, 2)
            shell_proxy.wait_for_idle()
            result = shell_proxy.verify_tree_integrity()
            assert result.get("valid", False), (
                f"tree invalid after tabbed close: {result.get('errors')}"
            )

        with step(shell_proxy, "toggle back to split -> count stable at 2"):
            input_sim.toggle_layout()
            assert len(shell_proxy.get_windows()) == 2

    def test_multi_window_stack_focus_moves(
        self, shell_proxy, input_sim, window_helper, dispatch_mode, launch_window, three_windows
    ):
        """Focus must move BETWEEN siblings in a genuine multi-window stacked/tabbed container.

        The sibling test above exercises only the single-item container Forge builds when you
        toggle stacked/tabbed on a flat monitor (it wraps just the focused window — by design).
        This builds a real >=2-child stack to cover cross-sibling navigation: toggling stacked
        points tree.attachNode at the new container (command.js LayoutStackedToggle), so a window
        launched AFTER the toggle attaches INTO it, yielding multiple siblings (verified spike).

        Determinism: stacked/tabbed siblings share one rect, so geometric focus is ambiguous.
        STACKED is a vertical stack -> focus_up walks its child order (focus_down is a no-op);
        TABBED lays tabs horizontally -> focus_left/right walk the tabs (focus_up/down are no-ops)
        (both verified by spike). Each assert first confirms the multi-child container exists, so
        a regression to single-item fails loudly instead of passing vacuously.
        """
        with step(shell_proxy, "build a 2-window STACKED container"):
            wait_for_window_count(shell_proxy, 3)
            input_sim.toggle_stacked()  # wraps focused window in a single-item STACKED CON
            wait_for_layout(shell_proxy, "STACKED")
            launch_window()  # attaches into that CON via tree.attachNode -> 2 siblings
            wait_for_window_count(shell_proxy, 4)
            shell_proxy.wait_for_idle()
            assert _layout_node_child_count(shell_proxy, "STACKED") >= 2, (
                "expected a multi-child STACKED container to drive sibling focus nav"
            )

        with step(shell_proxy, "focus moves between STACKED siblings, layout stays STACKED"):
            if dispatch_mode != "dbus":
                # Synthetic super-modifier nav is unreliable under Mutter's VirtualInputDevice
                # (forge-er8); keep the weaker "still focused & contained" check there.
                input_sim.focus_up()
                assert isinstance(window_helper.get_focused_id(), int)
                assert shell_proxy.get_container_layout() == "STACKED"
            else:
                # Pin focus to a known in-CON sibling first. Which window Mutter leaves
                # focused after launch_window() varies by GNOME version (the d801a7d family,
                # forge-fjs), so capturing `before` from launch order made the move assert
                # fragile (it failed on GNOME 45-48). The last stacked child always has a
                # previous sibling, so focus_up must move to it on every version.
                pinned = shell_proxy.activate_last_sibling_of("STACKED")
                assert "id" in pinned, (
                    f"could not pin focus inside the STACKED container: {pinned!r}"
                )
                shell_proxy.wait_for_idle()
                before = window_helper.get_focused_id()
                assert before == pinned["id"], (
                    f"pin did not take: focused {before}, expected {pinned['id']}"
                )
                input_sim.focus_up()
                window_helper.assert_focus_moved(before)  # moved to the stacked sibling
                assert shell_proxy.get_container_layout() == "STACKED"

        with step(shell_proxy, "same container -> TABBED, focus still moves between siblings"):
            input_sim.toggle_tabbed()  # parent is the CON now (not the monitor) -> just relayouts
            wait_for_layout(shell_proxy, "TABBED")
            assert _layout_node_child_count(shell_proxy, "TABBED") >= 2, (
                "expected the multi-child container to carry over into TABBED"
            )
            if dispatch_mode != "dbus":
                input_sim.focus_left()
                assert isinstance(window_helper.get_focused_id(), int)
                assert shell_proxy.get_container_layout() == "TABBED"
            else:
                # Same precondition as the STACKED branch: pin focus to the last tab (which
                # has a previous tab) so focus_left moves deterministically across versions.
                pinned = shell_proxy.activate_last_sibling_of("TABBED")
                assert "id" in pinned, (
                    f"could not pin focus inside the TABBED container: {pinned!r}"
                )
                shell_proxy.wait_for_idle()
                before = window_helper.get_focused_id()
                assert before == pinned["id"], (
                    f"pin did not take: focused {before}, expected {pinned['id']}"
                )
                input_sim.focus_left()  # tabs are horizontal -> move to the adjacent tab
                window_helper.assert_focus_moved(before)  # moved to the tabbed sibling
                assert shell_proxy.get_container_layout() == "TABBED"
