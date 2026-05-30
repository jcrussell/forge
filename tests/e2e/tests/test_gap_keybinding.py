"""
Gap-size keybinding increment/decrement tests for Forge (forge-a34.4).

Ctrl+Super+plus / Ctrl+Super+minus dispatch GapSize with amount +1/-1, which
mutates the `window-gap-size-increment` GSetting (clamped 0-32) and re-renders.
Effective inter-window gap = window-gap-size * window-gap-size-increment, so the
test sets a non-trivial base gap (default 4 yields only a 4px delta per step —
below tolerance) and asserts BOTH the GSetting and the measured pixel gap move.

Restore note: `window-gap-size-increment` is changed inside the extension by the
action, so ForgeSettings.restore_all() does NOT revert it (it only reverts keys
set via the Python .set()). Each test snapshots it and restores it in a finally.
Dispatch is the default dbus lane.
"""

from framework.constants import Tolerance
from framework.wait import wait_for, wait_for_stable


INCREMENT_KEY = "window-gap-size-increment"
BASE_GAP = 20  # matches test_settings_live.py; large enough for a measurable delta


def _gap_increase(shell_proxy):
    shell_proxy.invoke_forge_action({"name": "GapSize", "amount": 1})


def _gap_decrease(shell_proxy):
    shell_proxy.invoke_forge_action({"name": "GapSize", "amount": -1})


class TestGapKeybinding:
    def test_gap_increase_keybinding(
        self, shell_proxy, window_helper, forge_settings, restore_settings, two_windows
    ):
        """GapSize +1 should raise the increment GSetting and the pixel gap."""
        restore_settings.set_window_gap_size(BASE_GAP)
        orig_increment = forge_settings.get(INCREMENT_KEY)
        try:
            wait_for_stable(lambda: window_helper.measure_gap_between())
            gap_before = window_helper.measure_gap_between()

            _gap_increase(shell_proxy)

            inc_after = wait_for(
                lambda: forge_settings.get(INCREMENT_KEY),
                predicate=lambda v: v > orig_increment,
                message="window-gap-size-increment did not increase",
            )
            assert inc_after == orig_increment + 1

            gap_after = wait_for(
                lambda: window_helper.measure_gap_between(),
                predicate=lambda g: g > gap_before + Tolerance.RESIZE_MIN_DELTA,
                message="measured gap did not grow after GapSize +1",
            )
            assert gap_after > gap_before
        finally:
            forge_settings.set(INCREMENT_KEY, orig_increment)

    def test_gap_decrease_reverses(
        self, shell_proxy, window_helper, forge_settings, restore_settings, two_windows
    ):
        """GapSize -1 should undo a prior +1 in both GSetting and pixels."""
        restore_settings.set_window_gap_size(BASE_GAP)
        orig_increment = forge_settings.get(INCREMENT_KEY)
        try:
            wait_for_stable(lambda: window_helper.measure_gap_between())
            gap_base = window_helper.measure_gap_between()

            # Increase, then decrease back.
            _gap_increase(shell_proxy)
            gap_up = wait_for(
                lambda: window_helper.measure_gap_between(),
                predicate=lambda g: g > gap_base + Tolerance.RESIZE_MIN_DELTA,
                message="gap did not grow before decrement",
            )

            _gap_decrease(shell_proxy)
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
            assert abs(gap_back - gap_base) < Tolerance.SIZE
        finally:
            forge_settings.set(INCREMENT_KEY, orig_increment)
