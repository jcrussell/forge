"""Regression: is_window_floating() must report both tiled and floating.

Guards forge-g14. The helper previously walked the non-existent `ext.extWm.tree.root`
(Tree IS the root node — no `.root` property), so `isInTree` always saw an empty
tree and the helper was hardwired to return True. Existing float tests only ever
polled the True direction, so the bug hid. This asserts the FALSE direction too: a
freshly-tiled window is not floating, becomes floating after FloatToggle, and tiled
again after toggling back. Float state is the node's `mode`, never tree membership.
"""

from framework.wait import wait_for


class TestFloatStateRegression:
    def test_is_window_floating_reports_both_directions(self, shell_proxy, test_window):
        wm_class = test_window.get("wmClass")

        # Freshly tiled window must report NOT floating (the real fix; pre-g14 this
        # was hardwired True).
        assert shell_proxy.is_window_floating(wm_class) is False, (
            "tiled window should report not-floating"
        )

        # Toggle to floating.
        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({"name": "FloatToggle"})
        assert wait_for(lambda: shell_proxy.is_window_floating(wm_class), predicate=bool), (
            "window should report floating after FloatToggle"
        )

        # Toggle back to tiled.
        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({"name": "FloatToggle"})
        assert wait_for(
            lambda: shell_proxy.is_window_floating(wm_class) is False,
            predicate=bool,
        ), "window should report tiled after toggling float off"
