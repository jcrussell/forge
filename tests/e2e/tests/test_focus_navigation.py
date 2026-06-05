"""
Focus Navigation Tests for Forge.

Tests vim-style focus navigation with Super+h/j/k/l keys.
"""

import pytest

from framework.constants import Timing
from framework.wait import wait_for, wait_for_layout, wait_for_window_count


class TestFocusNavigation:
    """Test focus navigation with keyboard shortcuts."""

    def test_focus_left_right(
        self, shell_proxy, input_sim, window_helper, dispatch_mode, two_windows
    ):
        """Super+h and Super+l should move focus between the two tiled windows.

        Seeds focus to the left edge first (Focus Left lands on the leftmost
        window regardless of where focus started — Forge focus-nav stays at the
        edge, it never wraps), so the subsequent interior moves MUST change the
        focused window. forge-gwo: the old assert only checked wmClass truthiness,
        which get_focused_window() satisfies unconditionally (it auto-activates
        windows[0]) — it never proved focus actually moved.
        """
        input_sim.focus_left()

        if dispatch_mode != "dbus":
            # Synthetic super+h/l is unreliable under Mutter's VirtualInputDevice
            # (tile-snap latch, forge-er8); the keybinding gate lane only verifies
            # the keypress->Forge path survives, not focus correctness. Keep the
            # weaker "a window is focused" check there.
            assert isinstance(window_helper.get_focused_id(), int)
            input_sim.focus_right()
            assert isinstance(window_helper.get_focused_id(), int)
            return

        left_id = window_helper.get_focused_id()
        input_sim.focus_right()  # interior move from the left edge -> must change
        right_id = window_helper.assert_focus_moved(left_id)
        input_sim.focus_left()  # back toward the left edge -> must change
        window_helper.assert_focus_moved(right_id)

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

    def test_focus_up_down_in_vsplit(
        self, shell_proxy, input_sim, window_helper, dispatch_mode, two_windows
    ):
        """Super+j and Super+k should move focus between vertically-split windows.

        Focus-nav is structural (tree.next matches the move direction against the
        parent container's layout orientation), so the load-bearing precondition is
        a DETERMINISTIC focus seed: which window Mutter leaves focused after the
        toggle's renderTree varies by GNOME version (forge-fjs), and seeding via an
        action (focus_up) inherited that nondeterminism — it failed on GNOME 46
        because the seed didn't land on the top window, so the next move was an edge
        no-op. Pin the last sibling instead; wait_for_layout is the settle.
        """
        input_sim.toggle_layout()
        wait_for_layout(shell_proxy, "VSPLIT")  # the HSPLIT->VSPLIT toggle settled

        if dispatch_mode != "dbus":
            # Synthetic super+j/k is unreliable under Mutter's VirtualInputDevice
            # (forge-er8); the keybinding gate lane only checks the keypress->Forge
            # path survives, not focus correctness. Keep the weaker check there.
            input_sim.focus_up()
            assert isinstance(window_helper.get_focused_id(), int)
            input_sim.focus_down()
            assert isinstance(window_helper.get_focused_id(), int)
            return

        # Pin focus to the last sibling (bottom of the VSPLIT) so an interior move
        # MUST change the focused window, independent of the post-toggle focus.
        pinned = shell_proxy.activate_last_sibling_of("VSPLIT")
        assert "id" in pinned, f"could not pin focus inside the VSPLIT container: {pinned!r}"
        shell_proxy.wait_for_idle()
        assert shell_proxy.get_container_layout() == "VSPLIT"
        before = window_helper.get_focused_id()
        assert before == pinned["id"], f"pin did not take: focused {before}, expected {pinned['id']}"

        input_sim.focus_up()  # toward the previous sibling -> must move
        top_id = window_helper.assert_focus_moved(before)
        input_sim.focus_down()  # back toward the last sibling -> must move
        window_helper.assert_focus_moved(top_id)

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

    def test_focus_moves_after_close(self, shell_proxy, window_helper, two_windows):
        """Closing the focused window must move focus onto the surviving window.

        forge-12t: the old assert only checked that the focused window had a
        wmClass/title, which get_focused_window() satisfies unconditionally (it
        auto-activates a window) — a regression that left focus on nothing, or
        failed to refocus the survivor, would still pass. The two_windows fixture
        launches same-class windows and get_windows() carries no id, so the honest
        behavioral signal is: capture the to-be-closed window's id, close it, and
        prove focus landed on a DIFFERENT real window — which, with exactly one
        window left, is the survivor (forge-gwo id identity).

        Close via Mutter delete() (shell_proxy.close_focused_window), not a
        synthetic alt+F4: Clutter VirtualInputDevice fails to deliver alt+F4 to the
        window on older Mutter (GNOME 45-48), so the window never closed and the old
        len>=1 assert passed vacuously with both windows still open.
        """
        shell_proxy.ensure_focus()
        closed_id = window_helper.get_focused_id()

        shell_proxy.close_focused_window()

        survivors = wait_for_window_count(shell_proxy, 1)
        assert len(survivors) == 1, "exactly one window should remain after the close"

        # Focus must have moved off the closed window onto the survivor. wait_for
        # tolerates the brief focus-settle after the close (get_focused_id raises
        # while no window is focused; the poll retries).
        survivor_id = wait_for(
            window_helper.get_focused_id,
            predicate=lambda fid: fid != closed_id,
            message=f"focus did not move off the closed window (id {closed_id}) to the survivor",
        )
        assert survivor_id != closed_id
