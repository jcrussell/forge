"""Maximize/unmaximize compat-shim coverage (forge-bc1).

lib/extension/compat.js centralizes Meta.Window maximize APIs that drifted across
Mutter releases (branched on IS_MUTTER_49_PLUS). These tests drive the two
behavioral paths that use the shims and assert Mutter's own maximized state via
count_maximized_windows() — which feature-detects is_maximized()/get_maximized()
independently of Forge. Because the assertions are behavioral, each test
exercises whichever compat branch runs on the container's Mutter version
automatically (run via `make e2e-test-all` for full matrix coverage); no
version-gating is needed. NOTE: Compat.getMaximizeFlags() has no callers and so
is not exercised here.
"""

import time

from framework.constants import Timing
from framework.wait import wait_for, wait_for_window_count


class TestMaximizeCompat:
    def test_maximize_on_single_window(
        self, shell_proxy, restore_settings, two_windows
    ):
        """window-maximize-on-single: closing down to one window maximizes it.

        Exercises Compat.isNotMaximized + Compat.maximize (handleMaximizeOnSingle,
        run from renderTree).
        """
        restore_settings.set("window-maximize-on-single", True)

        time.sleep(Timing.SETTINGS_SETTLE)

        # Precondition: a tiled pair is not maximized.
        assert shell_proxy.count_maximized_windows() == 0

        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 1)

        wait_for(
            shell_proxy.count_maximized_windows,
            predicate=lambda n: n >= 1,
            message="single remaining window should be maximized via the compat shim",
        )

    def test_unmaximize_on_retile(self, shell_proxy, restore_settings, two_windows):
        """Re-tiling a maximized window unmaximizes it (Compat.unmaximize via move()).

        Maximize a lone window (window-maximize-on-single), disable that setting so
        it can't immediately re-maximize, then float it: Forge's move()
        unconditionally calls Compat.unmaximize (window.js), so Mutter no longer
        reports the window maximized. (Tiling a *new* window alongside is not used
        here — under headless the test app opens maximized and isn't re-tiled.)
        """
        restore_settings.set("window-maximize-on-single", True)
        time.sleep(Timing.SETTINGS_SETTLE)

        shell_proxy.close_one_window()
        wait_for_window_count(shell_proxy, 1)
        wait_for(
            shell_proxy.count_maximized_windows,
            predicate=lambda n: n >= 1,
            message="precondition: lone window should be maximized",
        )

        # Disable so the re-tile below can't immediately re-maximize the window.
        restore_settings.set("window-maximize-on-single", False)
        time.sleep(Timing.SETTINGS_SETTLE)

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action({"name": "FloatToggle"})
        wait_for(
            shell_proxy.count_maximized_windows,
            predicate=lambda n: n == 0,
            message="re-tiling the window should unmaximize it via the compat shim",
        )
