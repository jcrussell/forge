"""
Workflow WF5: gap / workspace / snap workflow (forge-911 / forge-wve).

Drives one 2-window set through gap inc/dec -> workspace roundtrip -> snap,
asserting at each step. Folds the gap-keybinding, workspace-roundtrip and a
representative snap-thirds atomic concern into a single launch.

Ordering note: SnapLayoutMove FLOATS the focused window (a per-window override,
auto-cleared when the window closes), so the snap step runs LAST — once a window
floats, the two-window gap/roundtrip assertions would no longer hold. The chained
snap transitions (left->right->center) stay in the single-window atomic snap
suite, where there's no focus/float ambiguity. The gap increment is registered
with restore_settings BEFORE the action mutates it (see test_gap_keybinding.py for
the trap of capturing it after).
"""

from framework.constants import Tolerance
from framework.wait import wait_for, wait_for_stable, wait_for_window_count
from framework.workflow import step


INCREMENT_KEY = "window-gap-size-increment"
BASE_GAP = 20  # matches test_gap_keybinding: large enough for a measurable delta


class TestWorkflowSnapGap:
    """One two-window set, sequenced through gap, workspace, and snap operations."""

    def test_gap_workspace_snap(
        self, shell_proxy, input_sim, window_helper, forge_settings, restore_settings, two_windows
    ):
        workspace = window_helper.get_workspace_rect()

        with step(shell_proxy, "set a base gap so increments are measurable"):
            wait_for_window_count(shell_proxy, 2)
            restore_settings.set_window_gap_size(BASE_GAP)
            # Register the increment for restoration BEFORE the action mutates it so
            # restore_all() reverts the true original (test_gap_keybinding docstring).
            orig_increment = forge_settings.get(INCREMENT_KEY)
            restore_settings.set(INCREMENT_KEY, orig_increment)
            wait_for_stable(lambda: window_helper.measure_gap_between())
            gap_before = window_helper.measure_gap_between()

        with step(shell_proxy, "GapSize +1 -> increment GSetting and pixel gap grow"):
            shell_proxy.invoke_forge_action({"name": "GapSize", "amount": 1})
            inc_after = wait_for(
                lambda: forge_settings.get(INCREMENT_KEY),
                predicate=lambda v: v > orig_increment,
                message="window-gap-size-increment did not increase",
            )
            assert inc_after == orig_increment + 1
            gap_up = wait_for(
                lambda: window_helper.measure_gap_between(),
                predicate=lambda g: g > gap_before + Tolerance.RESIZE_MIN_DELTA,
                message="measured gap did not grow after GapSize +1",
            )
            assert gap_up > gap_before

        with step(shell_proxy, "GapSize -1 -> increment and pixel gap return to base"):
            shell_proxy.invoke_forge_action({"name": "GapSize", "amount": -1})
            inc_back = wait_for(
                lambda: forge_settings.get(INCREMENT_KEY),
                predicate=lambda v: v == orig_increment,
                message="window-gap-size-increment did not return to baseline",
            )
            assert inc_back == orig_increment
            gap_back = wait_for(
                lambda: window_helper.measure_gap_between(),
                predicate=lambda g: g < gap_up - Tolerance.RESIZE_MIN_DELTA,
                message="measured gap did not shrink after GapSize -1",
            )
            assert abs(gap_back - gap_before) < Tolerance.SIZE

        with step(shell_proxy, "workspace switch and back -> two-window layout preserved"):
            sorted_before = window_helper.get_windows_sorted_by_position("x")
            rects_before = [w.get("rect", {}) for w in sorted_before]
            start_ws = shell_proxy.get_active_workspace_index()
            input_sim.workspace_next()
            wait_for(shell_proxy.get_active_workspace_index, predicate=lambda i: i != start_ws)
            input_sim.workspace_prev()
            wait_for(shell_proxy.get_active_workspace_index, predicate=lambda i: i == start_ws)
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
            rects_after = [w.get("rect", {}) for w in window_helper.get_windows_sorted_by_position("x")]
            assert len(rects_after) == len(rects_before), "window count changed across roundtrip"
            for before, after in zip(rects_before, rects_after):
                assert abs(before.get("x", 0) - after.get("x", 0)) < Tolerance.POSITION
                assert abs(before.get("width", 0) - after.get("width", 0)) < Tolerance.SIZE

        with step(shell_proxy, "snap leftmost window to left third -> narrow, left-aligned"):
            # focus_window pins the target deterministically; focusMetaWindow reads
            # global.display.get_focus_window(), which invoke_forge_action overrides.
            shell_proxy.invoke_forge_action(
                {"name": "SnapLayoutMove", "direction": "Left", "amount": 0.333},
                focus_window="leftmost",
            )
            wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
            wins = shell_proxy.get_windows()
            assert len(wins) == 2, "snap should not change window count"
            # The snapped (floated) window is the narrow one; identify by min width
            # rather than class (both windows share a wmClass).
            snapped = min(wins, key=lambda w: w.get("rect", {}).get("width", 0)).get("rect", {})
            assert abs(snapped.get("width", 0) / workspace["width"] - 1 / 3) < Tolerance.SNAP_RATIO, (
                f"snapped width ratio {snapped.get('width', 0) / workspace['width']:.3f} should be ~0.333"
            )
            # The non-default base gap set above is still active, so snap insets the
            # left edge by ~BASE_GAP rather than sitting flush at the workspace edge.
            # Allow for that inset (a right-snap would land at ~2/3 width, far past this).
            assert snapped.get("x", 0) - workspace["x"] < BASE_GAP + Tolerance.POSITION, (
                f"snapped window should be left-aligned: x={snapped.get('x')}, ws x={workspace['x']}"
            )
