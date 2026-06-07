"""
Dialog Window Tests for Forge.

Tests that dialog/transient windows are not tiled and don't
disrupt the tiling layout of other windows.
"""

import subprocess
import os

import pytest

from framework.constants import Tolerance
from framework.wait import wait_for, wait_for_stable, wait_for_window_count


def _safe_terminate(proc):
    """Terminate a subprocess safely with timeout and kill fallback."""
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def _open_zenity_dialog(display=None):
    """Open a zenity info dialog as a subprocess."""
    env = os.environ.copy()
    if display:
        env["DISPLAY"] = display
    elif "DISPLAY" not in env:
        env["DISPLAY"] = ":99"

    return subprocess.Popen(
        ["zenity", "--info", "--text=Test dialog", "--timeout=30"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )


def _zenity_present(windows):
    """True when a zenity window is present (wmClass is case-insensitive)."""
    return isinstance(windows, list) and any(
        w.get("wmClass", "").lower() == "zenity" for w in windows
    )


def _wait_zenity_closed(shell_proxy):
    """Block until no zenity window remains (forge-1wp).

    Replaces a fixed post-terminate sleep: a slow-to-die dialog could otherwise
    still be on-screen when the next test starts and perturb its tiling baseline.
    Polling the real post-condition (the window is gone) is both faster on the
    common path and correct on the slow one.
    """
    wait_for(
        shell_proxy.get_windows,
        predicate=lambda windows: not _zenity_present(windows),
        message="zenity dialog did not close",
    )


def _has_zenity():
    """Check if zenity is available."""
    try:
        subprocess.run(
            ["zenity", "--version"], capture_output=True, check=True
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


@pytest.fixture
def zenity_available():
    """Skip test if zenity is not available."""
    if not _has_zenity():
        pytest.skip("zenity not available")


class TestDialogWindows:
    """Test that dialog windows are handled correctly."""

    def test_modal_dialog_not_tiled(
        self, shell_proxy, input_sim, window_helper, test_window, zenity_available
    ):
        """A dialog window should not shrink the parent tiled window."""
        wm_class = test_window.get("wmClass")
        rect_before = window_helper.get_window_rect(wm_class)
        workspace = window_helper.get_workspace_rect()

        # Open a dialog and wait for it to actually appear.
        proc = _open_zenity_dialog()
        wait_for(shell_proxy.get_windows, predicate=_zenity_present,
                 message="zenity dialog did not appear")

        try:
            # Parent window should still be large (not shrunk by dialog tiling)
            rect_after = window_helper.get_window_rect(wm_class)
            assert rect_after[2] > workspace["width"] * 0.8, (
                f"Parent window should stay large: width {rect_after[2]} "
                f"vs workspace {workspace['width']}"
            )
        finally:
            _safe_terminate(proc)
            _wait_zenity_closed(shell_proxy)

    def test_dialog_preserves_tiling(
        self, shell_proxy, input_sim, window_helper, two_windows, zenity_available
    ):
        """Opening a dialog should not change existing tiled windows' positions."""
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
        sorted_before = window_helper.get_windows_sorted_by_position("x")
        rects_before = [w.get("rect", {}) for w in sorted_before]

        proc = _open_zenity_dialog()
        wait_for(shell_proxy.get_windows, predicate=_zenity_present,
                 message="zenity dialog did not appear")

        try:
            # Get only the tiled windows (exclude dialog)
            all_windows = shell_proxy.get_windows()
            tiled_windows = sorted(
                [w for w in all_windows if w.get("wmClass", "").lower() != "zenity"],
                key=lambda w: w.get("rect", {}).get("x", 0),
            )

            # The dialog must be excluded from the Forge tree (not a tiled node).
            # Use its real wmClass (case varies, e.g. "Zenity"); the tree query is
            # case-sensitive, so derive it from the live window rather than guessing.
            zenity_class = next(
                w.get("wmClass")
                for w in all_windows
                if w.get("wmClass", "").lower() == "zenity"
            )
            assert shell_proxy.count_tiled_windows_of_class(zenity_class) == 0, (
                f"Dialog '{zenity_class}' should not be a tiled node in the Forge tree"
            )

            for before_rect, tiled_win in zip(rects_before, tiled_windows):
                after_rect = tiled_win.get("rect", {})
                assert abs(before_rect.get("width", 0) - after_rect.get("width", 0)) < Tolerance.POSITION, (
                    f"Tiled window width changed: {before_rect.get('width')} -> {after_rect.get('width')}"
                )
        finally:
            _safe_terminate(proc)
            _wait_zenity_closed(shell_proxy)

    def test_dialog_window_type_detected(
        self, shell_proxy, test_window, zenity_available
    ):
        """At least one dialog window should be detected by window type."""
        proc = _open_zenity_dialog()
        wait_for(shell_proxy.get_windows, predicate=_zenity_present,
                 message="zenity dialog did not appear")

        try:
            js = """
            (function() {
                const actors = global.get_window_actors();
                const types = actors.map(a => {
                    const w = a.meta_window;
                    return {
                        wmClass: w.get_wm_class(),
                        windowType: w.get_window_type(),
                        transientFor: w.get_transient_for() ? true : false
                    };
                });
                return JSON.stringify(types);
            })();
            """
            result = shell_proxy.eval(js)

            has_dialog = any(
                w.get("windowType") in [1, 2] or w.get("transientFor", False)
                for w in result
                if isinstance(w, dict)
            )
            # Zenity may create a NORMAL window (type 0) in some versions,
            # so also check wmClass (case-insensitive)
            has_zenity = any(
                w.get("wmClass", "").lower() == "zenity"
                for w in result
                if isinstance(w, dict)
            )
            assert has_dialog or has_zenity, (
                f"Should detect dialog/transient window or zenity wmClass, got: {result}"
            )
        finally:
            _safe_terminate(proc)
            _wait_zenity_closed(shell_proxy)


class TestDialogCloseBehavior:
    """Test that closing dialogs preserves tiling state."""

    def test_closing_dialog_preserves_tiling(
        self, shell_proxy, window_helper, test_window, zenity_available
    ):
        """Closing a dialog should restore original window count."""
        count_before = len(shell_proxy.get_windows())

        proc = _open_zenity_dialog()
        wait_for(shell_proxy.get_windows, predicate=_zenity_present,
                 message="zenity dialog did not appear")

        _safe_terminate(proc)
        windows = wait_for_window_count(shell_proxy, count_before)

        count_after = len(windows)
        assert count_after == count_before, (
            f"Window count should be restored: {count_before} -> {count_after}"
        )

    def test_multiple_dialogs_dont_break_tiling(
        self, shell_proxy, window_helper, test_window, zenity_available
    ):
        """Opening and closing multiple dialogs should not break tiling."""
        wm_class = test_window.get("wmClass")

        for _ in range(3):
            proc = _open_zenity_dialog()
            wait_for(shell_proxy.get_windows, predicate=_zenity_present,
                     message="zenity dialog did not appear")
            _safe_terminate(proc)
            _wait_zenity_closed(shell_proxy)

        # Single window should still fill workspace
        workspace = window_helper.get_workspace_rect()
        rect = window_helper.get_window_rect(wm_class)
        assert abs(rect[2] - workspace["width"]) < Tolerance.SIZE, (
            f"Window should still fill workspace after dialogs: "
            f"width {rect[2]} vs {workspace['width']}"
        )
