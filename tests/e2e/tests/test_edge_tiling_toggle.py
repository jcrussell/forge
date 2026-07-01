"""
E2E test: GNOME edge-tiling override follows the runtime tiling-mode toggle
(forge-abk).

Forge overrides org.gnome.mutter edge-tiling to false while tiling is active (and
the user hasn't opted out via disable-edge-tiling). Toggling Forge's tiling mode
off at runtime must restore GNOME's native edge-tiling; toggling it back on must
re-apply the override.

The test controls the "native" value itself (sets edge-tiling=true while Forge is
NOT overriding) so the assertions don't depend on the container's baseline.
"""

import time

from framework.constants import Timing


def _get_edge_tiling(shell_proxy) -> bool:
    val = shell_proxy.eval(
        "const Gio = imports.gi.Gio; "
        "Gio.Settings.new('org.gnome.mutter').get_boolean('edge-tiling')"
    )
    return val is True or val == "true"


def _set_edge_tiling(shell_proxy, value: bool) -> None:
    shell_proxy.eval(
        "const Gio = imports.gi.Gio; "
        "Gio.Settings.new('org.gnome.mutter').set_boolean('edge-tiling', %s)"
        % ("true" if value else "false")
    )


class TestEdgeTilingFollowsTilingMode:
    """forge-abk: edge-tiling override reconciles on the tiling-mode toggle."""

    def test_toggle_restores_and_reapplies_edge_tiling(self, shell_proxy, restore_settings):
        rs = restore_settings
        # Opt in to the edge-tiling override, and start with tiling OFF so Forge
        # is NOT currently overriding edge-tiling.
        rs.set("disable-edge-tiling", True)
        rs.set("tiling-mode-enabled", False)
        time.sleep(Timing.SETTINGS_SETTLE)

        # Establish a known "native" value while Forge is not overriding.
        _set_edge_tiling(shell_proxy, True)
        time.sleep(Timing.SETTINGS_SETTLE)
        assert _get_edge_tiling(shell_proxy) is True, (
            "with tiling off, Forge must not override edge-tiling"
        )

        # Toggle tiling ON -> Forge applies its override (edge-tiling off),
        # capturing the native value (true) as the restore target.
        rs.set("tiling-mode-enabled", True)
        time.sleep(Timing.SETTINGS_SETTLE)
        assert _get_edge_tiling(shell_proxy) is False, (
            "edge-tiling should be overridden (false) when tiling is on"
        )

        # Toggle tiling OFF -> Forge restores the captured native value (true).
        rs.set("tiling-mode-enabled", False)
        time.sleep(Timing.SETTINGS_SETTLE)
        assert _get_edge_tiling(shell_proxy) is True, (
            "edge-tiling should be restored to native (true) when tiling is off"
        )
