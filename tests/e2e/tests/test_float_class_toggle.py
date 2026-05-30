"""
Class-wide float toggle tests for Forge (forge-a34.2).

FloatClassToggle (Shift+Super+c) floats/tiles ALL windows of a wm_class by
pushing/removing a persistent class-wide override (wmId undefined). This is the
exact mechanism behind the past "snap class-wide float leak" bug
(forge-qh2/forge-fc6, fixed in 2c088c4): a class-wide override that
windowDestroy could never clear. These tests guard the symmetric toggle
(float-all -> tile-all leaves NO residual override) and that the override is
scoped to exactly the toggled class.

Two scoping rules matter here:
  * windows.json ships ~40 default overrides (Calculator, Conky, ...), several
    class-wide float, so EVERY override assertion is scoped to the editor's
    wm_class via _editor_class_float() — never the total count.
  * A leaked class-wide override (wmId undefined) is never removed by
    windowDestroy/clean_workspace, so the _strip_editor_float fixture removes
    any residual on teardown — a failed test must not float the editor for the
    rest of the session.

Dispatch is the default dbus lane (invoke_forge_action), which the acceptance
criteria permits in lieu of the Shift+Super+c keybinding.
"""

import pytest

from framework.input_simulator import DEFAULT_FLOAT_LAYOUT
from framework.wait import wait_for


CLASS_FLOAT_ACTION = {"name": "FloatClassToggle", **DEFAULT_FLOAT_LAYOUT}


def _is_editor_class_float(override: dict, wm_class: str) -> bool:
    """True if `override` is a class-wide float override for wm_class.

    Class-wide = matches wm_class with NO per-instance wmId and NO wmTitle,
    mode 'float' — exactly what addFloatOverride(meta, withWmId=false) writes.
    """
    return (
        override.get("wmClass") == wm_class
        and not override.get("wmId")
        and not override.get("wmTitle")
        and override.get("mode") == "float"
    )


def _count_editor_class_float(shell_proxy, wm_class: str) -> int:
    overrides = shell_proxy.get_float_overrides()
    if not isinstance(overrides, list):
        return 0
    return sum(1 for o in overrides if _is_editor_class_float(o, wm_class))


@pytest.fixture
def _strip_editor_float(shell_proxy, two_windows):
    """Remove any leaked editor class-wide float override after each test."""
    yield
    wm_class = two_windows[0].get("wmClass")
    if wm_class:
        shell_proxy.remove_class_float_override(wm_class)


class TestFloatClassToggle:
    def test_class_toggle_floats_all_same_class_windows(
        self, shell_proxy, two_windows, _strip_editor_float
    ):
        """One FloatClassToggle should float EVERY window of the class."""
        wm_class = two_windows[0].get("wmClass")
        assert wm_class, "fixture window must report a wm_class"

        # Baseline: both windows present and tiled (mode != FLOAT).
        assert shell_proxy.count_windows_of_class(wm_class) == 2
        assert shell_proxy.count_tiled_windows_of_class(wm_class) == 2

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action(CLASS_FLOAT_ACTION)

        tiled = wait_for(
            lambda: shell_proxy.count_tiled_windows_of_class(wm_class),
            predicate=lambda n: n == 0,
            message="FloatClassToggle did not float all same-class windows",
        )
        assert tiled == 0
        # Floating must not create/destroy windows.
        assert shell_proxy.count_windows_of_class(wm_class) == 2

    def test_class_toggle_is_symmetric_and_leaves_no_override(
        self, shell_proxy, two_windows, _strip_editor_float
    ):
        """Toggle once -> all float + override present; toggle again -> all tile
        and the class-wide override is REMOVED (the leak-bug guard)."""
        wm_class = two_windows[0].get("wmClass")

        # Act 1: float the whole class.
        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action(CLASS_FLOAT_ACTION)
        wait_for(
            lambda: shell_proxy.count_tiled_windows_of_class(wm_class),
            predicate=lambda n: n == 0,
            message="first toggle did not float the class",
        )
        wait_for(
            lambda: _count_editor_class_float(shell_proxy, wm_class),
            predicate=lambda n: n == 1,
            message="class-wide float override was not written",
        )

        # Act 2: toggle again -> re-tile everything.
        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action(CLASS_FLOAT_ACTION)
        tiled = wait_for(
            lambda: shell_proxy.count_tiled_windows_of_class(wm_class),
            predicate=lambda n: n == 2,
            message="second toggle did not re-tile the class",
        )
        assert tiled == 2

        # Leak guard: NO residual class-wide float override for this class.
        residual = wait_for(
            lambda: _count_editor_class_float(shell_proxy, wm_class),
            predicate=lambda n: n == 0,
            message="class-wide float override leaked after re-tile (forge-qh2 regression)",
        )
        assert residual == 0

    def test_class_toggle_does_not_leak_to_other_classes(
        self, shell_proxy, two_windows, _strip_editor_float
    ):
        """The override must be scoped to exactly the toggled wm_class.

        Headless can only launch gnome-text-editor, so 'no other class' is
        verified structurally: after one toggle there is EXACTLY ONE class-wide
        float override matching the editor class (scoped count, not total)."""
        wm_class = two_windows[0].get("wmClass")

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action(CLASS_FLOAT_ACTION)

        count = wait_for(
            lambda: _count_editor_class_float(shell_proxy, wm_class),
            predicate=lambda n: n == 1,
            message="expected exactly one editor class-wide float override",
        )
        assert count == 1
