"""
Focus Navigation Tests for Forge.

Tests vim-style focus navigation with Super+h/j/k/l keys.
"""

import pytest

from framework.constants import Timing


class TestFocusNavigation:
    """Test focus navigation with keyboard shortcuts."""

    def test_focus_left_right(self, shell_proxy, input_sim, two_windows):
        """Super+h and Super+l should move focus left and right."""
        window1, window2 = two_windows

        # Navigate left
        input_sim.focus_left()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "A window should be focused after Super+h"

        # Navigate right
        input_sim.focus_right()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "A window should be focused after Super+l"

    def test_focus_wraps_or_stays(self, shell_proxy, input_sim, test_window):
        """Focus navigation at edge should wrap or stay in place."""
        wm_class = test_window.get("wmClass")

        # With single window, focus should stay on same window
        input_sim.focus_left()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass") == wm_class, (
            "Focus should stay on only window when navigating left"
        )

        input_sim.focus_right()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass") == wm_class, (
            "Focus should stay on only window when navigating right"
        )

    def test_focus_up_down_in_vsplit(self, shell_proxy, input_sim, two_windows):
        """Super+j and Super+k should navigate in vertical split."""
        # Toggle to vertical split
        input_sim.toggle_layout()

        # Navigate up/down
        input_sim.focus_down()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "A window should be focused after Super+j"

        input_sim.focus_up()

        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass"), "A window should be focused after Super+k"

    def test_focus_cycles_through_windows(self, shell_proxy, input_sim, three_windows):
        """Focus should cycle through all windows."""
        # Perform focus cycling entirely within a single D-Bus eval to avoid
        # Xvfb focus loss between separate D-Bus calls and xdotool unreliability.
        js = """
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return JSON.stringify({error: 'Forge not loaded'});
                const ext = forge.stateObj;
                if (!ext.extWm) return JSON.stringify({error: 'extWm not available'});

                const ws = global.workspace_manager.get_active_workspace();
                const wins = ws.list_windows();
                if (wins.length < 2) return JSON.stringify({error: 'Need >= 2 windows', count: wins.length});

                const origFn = global.display.get_focus_window;
                const positions = [];

                // Activate the first window as starting point
                wins[0].activate(global.get_current_time());
                let lastKnown = wins[0];
                positions.push(lastKnown.get_frame_rect().x);

                // Navigate right 6 times, collecting focused positions
                for (let i = 0; i < 6; i++) {
                    if (!origFn.call(global.display)) {
                        global.display.get_focus_window = function() { return lastKnown; };
                    }
                    ext.extWm.command({name: "Focus", direction: "Right"});
                    global.display.get_focus_window = origFn;

                    let f = origFn.call(global.display);
                    if (f) lastKnown = f;
                    positions.push(lastKnown.get_frame_rect().x);
                }

                // Navigate left 6 times
                for (let i = 0; i < 6; i++) {
                    if (!origFn.call(global.display)) {
                        global.display.get_focus_window = function() { return lastKnown; };
                    }
                    ext.extWm.command({name: "Focus", direction: "Left"});
                    global.display.get_focus_window = origFn;

                    let f = origFn.call(global.display);
                    if (f) lastKnown = f;
                    positions.push(lastKnown.get_frame_rect().x);
                }

                const unique = [...new Set(positions)];
                return JSON.stringify({positions: unique});
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        result = shell_proxy.eval(js)
        assert "error" not in result, f"Focus cycling eval failed: {result.get('error')}"
        positions = result.get("positions", [])
        assert len(positions) >= 2, (
            f"Should focus at least 2 distinct windows, only saw positions: {positions}"
        )


class TestFocusAfterClose:
    """Test focus behavior after closing windows."""

    def test_focus_moves_after_close(self, shell_proxy, input_sim, two_windows):
        """Focus should move to another window when focused window is closed."""
        # Close the focused window
        input_sim.close_active_window()

        # Should have at least one window remaining
        windows = shell_proxy.get_windows()
        assert len(windows) >= 1, "Should have at least one window remaining"

        # Remaining window should have focus
        focused = shell_proxy.get_focused_window()
        assert focused.get("wmClass") or focused.get("title"), (
            "Remaining window should receive focus"
        )
