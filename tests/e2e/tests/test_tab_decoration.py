"""
Tab-decoration toggle test for Forge (forge-a34.6).

Ctrl+Alt+y dispatches ShowTabDecorationToggle, which flips the
`showtab-decoration-enabled` GSetting. The command is guarded by a focused node
+ `tabbed-tiling-mode-enabled`, so the test enables tabbed mode and builds a
tabbed container first.

Restore note: `showtab-decoration-enabled` is flipped inside the extension, so
ForgeSettings.restore_all() does NOT revert it — the test snapshots and restores
it in a finally. `tabbed-tiling-mode-enabled` is set from Python via
restore_settings, which reverts it automatically. Dispatch is the default dbus lane.
"""

from framework.wait import wait_for

DECORATION_KEY = "showtab-decoration-enabled"
DECORATION_ACTION = {"name": "ShowTabDecorationToggle"}


class TestTabDecoration:
    def test_tab_decoration_toggles_setting(
        self, shell_proxy, input_sim, forge_settings, restore_settings, two_windows
    ):
        """ShowTabDecorationToggle should flip showtab-decoration-enabled both ways."""
        # Enable tabbed mode before building the tabbed container
        # (LayoutTabbedToggle early-returns while the setting is false). The write
        # goes through the extension, so it sees the new value straight away.
        restore_settings.set_tabbed_tiling_mode_enabled(True)

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
