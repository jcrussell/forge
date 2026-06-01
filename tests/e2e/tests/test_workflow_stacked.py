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

    def test_stacked_tabbed_focus(self, shell_proxy, input_sim, three_windows):
        with step(shell_proxy, "three windows tiled"):
            wait_for_window_count(shell_proxy, 3)

        with step(shell_proxy, "toggle STACKED -> container reports STACKED, 3 windows"):
            input_sim.toggle_stacked()  # self-settles: STACKED_LAYOUT_CHANGE + wait_for_idle
            wait_for_layout(shell_proxy, "STACKED")
            assert len(shell_proxy.get_windows()) == 3

        with step(shell_proxy, "navigate focus down/up within the stack"):
            input_sim.focus_down()
            assert shell_proxy.get_focused_window().get("wmClass")
            input_sim.focus_up()
            assert shell_proxy.get_focused_window().get("wmClass")

        with step(shell_proxy, "toggle TABBED -> container reports TABBED, 3 windows"):
            input_sim.toggle_tabbed()  # self-settles
            wait_for_layout(shell_proxy, "TABBED")
            assert len(shell_proxy.get_windows()) == 3

        with step(shell_proxy, "cycle focus across tabs -> stays on a real node"):
            for _ in range(3):
                input_sim.focus_right()
                assert shell_proxy.get_focused_window().get("wmClass"), (
                    "a window should stay focused while cycling tabs"
                )
                # node path resolves a tab even though all tabs share one rect
                assert shell_proxy.get_focused_node_path(), "focused node path should resolve"

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
