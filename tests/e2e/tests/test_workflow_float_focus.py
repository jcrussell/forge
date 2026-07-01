"""
Workflow WF3: float lifecycle + focus workflow (forge-911 / forge-3m6).

Drives one 2-window set through tiled -> float one -> back to tiled, with focus
navigation, asserting at each step. Folds the float-toggle (single + one-of-two),
float-state-both-directions and focus-nav atomic concerns into a single launch.

The float is toggled OFF while the floated window is still focused (no navigation
in between), so FloatToggle reliably targets the floating window. Float state is
read with is_focused_window_floating() (identity-based) — never
is_window_floating(wm_class), which is first-match-by-class and ambiguous with two
same-class editors. The workflow ends fully tiled, leaving no float state for the
next test.
"""

from framework.constants import Tolerance
from framework.wait import wait_for, wait_for_stable, wait_for_window_count
from framework.workflow import step


class TestWorkflowFloatFocus:
    """One two-window set, sequenced through the float lifecycle + focus nav."""

    def test_float_focus(self, shell_proxy, input_sim, window_helper, dispatch_mode, two_windows):
        workspace = window_helper.get_workspace_rect()

        with step(shell_proxy, "two windows tiled; focused window is not floating"):
            wait_for_window_count(shell_proxy, 2)
            shell_proxy.ensure_focus()
            assert shell_proxy.is_focused_window_floating() is False, (
                "freshly tiled focused window should not be floating"
            )

        with step(shell_proxy, "float the focused window -> centers ~65%x75%, other fills"):
            shell_proxy.ensure_focus()
            shell_proxy.invoke_forge_action(
                {
                    "name": "FloatToggle",
                    "x": "center",
                    "y": "center",
                    "width": 0.65,
                    "height": 0.75,
                }
            )
            wait_for(shell_proxy.is_focused_window_floating, predicate=bool)
            wait_for_stable(lambda: shell_proxy.get_focused_window().get("rect"))
            fr = shell_proxy.get_focused_window().get("rect", {})
            assert abs(fr.get("width", 0) - int(workspace["width"] * 0.65)) < Tolerance.CENTERING, (
                f"floated width {fr.get('width')} should be ~{int(workspace['width'] * 0.65)}"
            )
            assert (
                abs(fr.get("height", 0) - int(workspace["height"] * 0.75)) < Tolerance.CENTERING
            ), f"floated height {fr.get('height')} should be ~{int(workspace['height'] * 0.75)}"
            assert any(
                w.get("rect", {}).get("width", 0) > workspace["width"] * 0.8
                for w in shell_proxy.get_windows()
            ), "the remaining tiled window should expand into the freed space"

        with step(shell_proxy, "toggle float off -> both windows tiled, side by side"):
            shell_proxy.ensure_focus()
            shell_proxy.invoke_forge_action({"name": "FloatToggle"})
            wait_for(shell_proxy.is_focused_window_floating, predicate=lambda v: not v)
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
            assert len(shell_proxy.get_windows()) == 2, "float toggle must preserve window count"
            cols = window_helper.get_windows_sorted_by_position("x")
            left, right = cols[0]["rect"], cols[1]["rect"]
            assert abs(right["x"] - (left["x"] + left["width"])) < Tolerance.SIZE, (
                f"re-tiled pair not side by side: left ends {left['x'] + left['width']}, "
                f"right at {right['x']}"
            )

        with step(shell_proxy, "navigate focus across the re-tiled pair -> focus moves"):
            # Seed to the left edge, then move right: an interior move that MUST
            # land on a different window (forge-gwo — the old assert only checked
            # wmClass truthiness, which get_focused_window auto-activation always
            # satisfies). Edge behavior is stay-not-wrap, so seeding makes the move
            # deterministic.
            input_sim.focus_left()
            if dispatch_mode == "dbus":
                left_id = window_helper.get_focused_id()
                input_sim.focus_right()
                window_helper.assert_focus_moved(left_id)
            else:
                input_sim.focus_right()
                assert isinstance(window_helper.get_focused_id(), int)
