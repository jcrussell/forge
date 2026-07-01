"""
Tab-decoration toggle test for Forge (forge-a34.6).

Ctrl+Alt+y dispatches ShowTabDecorationToggle, which flips the
`showtab-decoration-enabled` GSetting. The command is guarded by a focused node
+ `tabbed-tiling-mode-enabled`, so the test enables tabbed mode (waiting for the
extension to actually observe the GSetting before toggling the layout, since the
write propagates asynchronously) and builds a tabbed container first.

Restore note: `showtab-decoration-enabled` is flipped inside the extension, so
ForgeSettings.restore_all() does NOT revert it — the test snapshots and restores
it in a finally. `tabbed-tiling-mode-enabled` is set from Python via
restore_settings, which reverts it automatically. Dispatch is the default dbus lane.
"""

from framework.wait import wait_for

DECORATION_KEY = "showtab-decoration-enabled"
TABBED_MODE_KEY = "tabbed-tiling-mode-enabled"
DECORATION_ACTION = {"name": "ShowTabDecorationToggle"}


def _ext_sees_tabbed_enabled(shell_proxy) -> bool:
    """True once the extension's in-process settings see tabbed mode enabled."""
    js = (
        "(function(){"
        "const e=Main.extensionManager.lookup('forge@jmmaranan.com');"
        "if(!e||!e.stateObj||!e.stateObj.settings) return 'false';"
        "return String(e.stateObj.settings.get_boolean('tabbed-tiling-mode-enabled'));"
        "})();"
    )
    return shell_proxy.eval(js) == "true"


class TestTabDecoration:
    def test_tab_decoration_toggles_setting(
        self, shell_proxy, input_sim, forge_settings, restore_settings, two_windows
    ):
        """ShowTabDecorationToggle should flip showtab-decoration-enabled both ways."""
        # Enable tabbed mode and wait for the extension to observe it before
        # building the tabbed container (LayoutTabbedToggle early-returns if the
        # setting is still false in-process).
        restore_settings.set_tabbed_tiling_mode_enabled(True)
        wait_for(
            lambda: _ext_sees_tabbed_enabled(shell_proxy),
            predicate=bool,
            message="extension did not observe tabbed-tiling-mode-enabled",
        )

        input_sim.toggle_tabbed()
        shell_proxy.ensure_focus()

        orig = forge_settings.get(DECORATION_KEY)
        try:
            shell_proxy.invoke_forge_action(DECORATION_ACTION)
            flipped = wait_for(
                lambda: forge_settings.get(DECORATION_KEY),
                predicate=lambda v: v != orig,
                message="showtab-decoration-enabled did not toggle",
            )
            assert flipped == (not orig)

            shell_proxy.invoke_forge_action(DECORATION_ACTION)
            restored = wait_for(
                lambda: forge_settings.get(DECORATION_KEY),
                predicate=lambda v: v == orig,
                message="showtab-decoration-enabled did not toggle back",
            )
            assert restored == orig
        finally:
            forge_settings.set(DECORATION_KEY, orig)
