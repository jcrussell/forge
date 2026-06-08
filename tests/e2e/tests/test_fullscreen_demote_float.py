"""forge-zo4 (gh-460): always-on-top floats demote under a fullscreen window.

When a window goes fullscreen, Forge-pinned always-on-top floats on the same
monitor must drop below it instead of rendering over the fullscreen surface.
_reconcileFullscreenFloatDemotion() unmake_above()'s them while a fullscreen
window is present and re-pins them once it clears.

This verifies the real in-fullscreen-changed -> reconcile path end-to-end AND
the previously-unverified Mutter assumption that unmake_above() actually lowers
the float BELOW the fullscreen window in the stacking order.
"""

import time

from framework.constants import Timing
from framework.wait import wait_for

FLOAT_TOGGLE = {
    "name": "FloatToggle",
    "mode": "float",
    "x": "center",
    "y": "center",
    "width": 0.65,
    "height": 0.75,
}

_NORMAL_WINS = (
    "let ws=global.workspace_manager.get_active_workspace();"
    "let wins=global.display.list_all_windows().filter(w=>"
    " w.get_window_type()===Meta.WindowType.NORMAL && w.get_workspace()===ws);"
)


def _count_above_normal(shell_proxy) -> int:
    return shell_proxy.eval(
        "(function(){" + _NORMAL_WINS + "return wins.filter(w=>w.is_above()).length;})();"
    )


def _fullscreen_a_tiled_window(shell_proxy) -> str:
    return shell_proxy.eval(
        "(function(){" + _NORMAL_WINS + "let t=wins.find(w=>!w.is_above());"
        "if(!t) return 'none';t.make_fullscreen();return 'ok';})();"
    )


def _unfullscreen_all(shell_proxy) -> str:
    return shell_proxy.eval(
        "(function(){global.display.list_all_windows().forEach(w=>{"
        "if(w.is_fullscreen()) w.unmake_fullscreen();});return 'ok';})();"
    )


def _fullscreen_stacked_above_float(shell_proxy) -> str:
    return shell_proxy.eval(
        "(function(){" + _NORMAL_WINS + "let fs=wins.find(w=>w.is_fullscreen());"
        "let fl=wins.find(w=>!w.is_fullscreen());"
        "if(!fs||!fl) return 'missing';"
        "let stack=global.display.sort_windows_by_stacking(wins);"
        "return stack.indexOf(fs) > stack.indexOf(fl) ? 'fs-above' : 'fs-below';})();"
    )


class TestFullscreenDemoteFloat:
    def test_float_demotes_under_fullscreen_and_restores(
        self, shell_proxy, restore_settings, two_windows
    ):
        restore_settings.set_float_always_on_top(True)
        time.sleep(Timing.SETTINGS_SETTLE)
        shell_proxy.ensure_focus()

        # Float the focused window; with float-always-on-top it is pinned above.
        shell_proxy.invoke_forge_action(FLOAT_TOGGLE)
        wait_for(
            lambda: _count_above_normal(shell_proxy),
            predicate=lambda n: n == 1,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="floated window was not pinned always-on-top",
        )

        # A tiled window goes fullscreen -> the float must be demoted.
        assert _fullscreen_a_tiled_window(shell_proxy) == "ok"
        wait_for(
            lambda: _count_above_normal(shell_proxy),
            predicate=lambda n: n == 0,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="float was not demoted (still always-on-top) under the fullscreen window",
        )

        # The Mutter assumption: the fullscreen window is now stacked above the float.
        assert _fullscreen_stacked_above_float(shell_proxy) == "fs-above", (
            "unmake_above() did not lower the float below the fullscreen window"
        )

        # Exiting fullscreen restores the float above.
        assert _unfullscreen_all(shell_proxy) == "ok"
        wait_for(
            lambda: _count_above_normal(shell_proxy),
            predicate=lambda n: n == 1,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="float was not restored always-on-top after leaving fullscreen",
        )
