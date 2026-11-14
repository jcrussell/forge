"""
Dialog Window Tests for Forge.

Tests that dialog/transient windows are not tiled, don't
disrupt the tiling layout of other windows and are not left
on top of a tiled neighbour of their parent.

The dialog is the test window's own modal child (transient-for set to the test
window), opened and closed by signalling the test window's process, so it opens
over a window that is already tiled. Forge floats it by its transient parent
(_floatsByRole). Every assertion waits for Forge to settle first: Forge decides
float vs tile about 200ms after a window appears, not when it is first listed.
"""

import os
import signal

import pytest
from framework.constants import Tolerance
from framework.geometry import as_rect, overlap_area
from framework.wait import wait_for, wait_for_stable


def _dialog_title(window):
    return f"{window['title']} (dialog)"


def _dialog_listed(shell_proxy, window):
    return any(w.get("title") == _dialog_title(window) for w in shell_proxy.get_windows())


def _open_dialog(shell_proxy, window_helper, window):
    """Open `window`'s modal dialog and wait until Forge and the layout settle."""
    os.kill(window["pid"], signal.SIGUSR1)
    wait_for(lambda: _dialog_listed(shell_proxy, window), message="dialog did not appear")
    shell_proxy.wait_for_forge_settled()
    wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))


def _close_dialog(shell_proxy, window_helper, window):
    """Close `window`'s dialog and wait until Forge and the layout settle."""
    os.kill(window["pid"], signal.SIGUSR2)
    wait_for(
        lambda: _dialog_listed(shell_proxy, window),
        predicate=lambda listed: not listed,
        message="dialog did not close",
    )
    shell_proxy.wait_for_forge_settled()
    wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))


def _main_window_rect(shell_proxy, window):
    """The rect of `window` itself (not its same-class dialog), matched by title."""
    return next(w["rect"] for w in shell_proxy.get_windows() if w.get("title") == window["title"])


class TestDialogWindows:
    """Test that dialog windows are handled correctly."""

    def test_modal_dialog_not_tiled(self, shell_proxy, window_helper, test_window):
        """A dialog window should not shrink the parent tiled window."""
        workspace = window_helper.get_workspace_rect()

        _open_dialog(shell_proxy, window_helper, test_window)

        width = _main_window_rect(shell_proxy, test_window)["width"]
        assert width > workspace["width"] * 0.8, (
            f"Parent window should stay large: width {width} vs workspace {workspace['width']}"
        )

    def test_dialog_preserves_tiling(self, shell_proxy, window_helper, two_windows):
        """Opening a dialog should not change existing tiled windows' positions."""
        rects_before = [w["rect"] for w in window_helper.get_windows_sorted_by_position("x")]

        _open_dialog(shell_proxy, window_helper, two_windows[0])

        wm_class = two_windows[0]["wmClass"]
        assert shell_proxy.count_tiled_windows_of_class(wm_class) == 2, (
            "the dialog should not be a tiled node in the Forge tree"
        )
        tiled_after = sorted(
            (_main_window_rect(shell_proxy, w) for w in two_windows), key=lambda r: r["x"]
        )
        for before, after in zip(rects_before, tiled_after):
            assert abs(before["width"] - after["width"]) < Tolerance.POSITION, (
                f"Tiled window width changed: {before['width']} -> {after['width']}"
            )

    def test_dialog_is_not_tiled(self, shell_proxy, window_helper, test_window):
        """A dialog window must not become a tiled node in the Forge tree.

        The dialog shares the test window's class, so with both open exactly one
        tiled node of that class means the dialog was kept out of the tree.
        """
        _open_dialog(shell_proxy, window_helper, test_window)

        wm_class = test_window["wmClass"]
        assert shell_proxy.count_windows_of_class(wm_class) == 2
        assert shell_proxy.count_tiled_windows_of_class(wm_class) == 1, (
            "Dialog should not be a tiled node in the Forge tree"
        )


class TestDialogCloseBehavior:
    """Test that closing dialogs preserves tiling state."""

    def test_closing_dialog_preserves_tiling(self, shell_proxy, window_helper, two_windows):
        """Closing a dialog leaves both tiled windows tiled where they were."""
        rects_before = [_main_window_rect(shell_proxy, w) for w in two_windows]

        _open_dialog(shell_proxy, window_helper, two_windows[0])
        _close_dialog(shell_proxy, window_helper, two_windows[0])

        assert shell_proxy.count_tiled_windows_of_class(two_windows[0]["wmClass"]) == 2, (
            "both windows should still be tiled after the dialog closed"
        )
        for window, before in zip(two_windows, rects_before):
            after = _main_window_rect(shell_proxy, window)
            for key in ("x", "width"):
                assert abs(before[key] - after[key]) < Tolerance.POSITION, (
                    f"{window['title']} {key} changed: {before[key]} -> {after[key]}"
                )

    def test_multiple_dialogs_dont_break_tiling(self, shell_proxy, window_helper, test_window):
        """Opening and closing multiple dialogs should not break tiling."""
        for _ in range(3):
            _open_dialog(shell_proxy, window_helper, test_window)
            _close_dialog(shell_proxy, window_helper, test_window)

        # Single window should still fill workspace
        workspace = window_helper.get_workspace_rect()
        width = _main_window_rect(shell_proxy, test_window)["width"]
        assert abs(width - workspace["width"]) < Tolerance.SIZE, (
            f"Window should still fill workspace after dialogs: "
            f"width {width} vs {workspace['width']}"
        )


def _rect_of(shell_proxy, title):
    return next(as_rect(w["rect"]) for w in shell_proxy.get_windows() if w.get("title") == title)


MUTTER = "imports.gi.Gio.Settings.new('org.gnome.mutter')"


@pytest.fixture
def detached_dialogs(shell_proxy):
    """Turn off attach-modal-dialogs (GNOME Shell turns it on), under which Mutter
    keeps a modal dialog centred on its parent and no move can misplace it."""
    prior = shell_proxy.eval(f"{MUTTER}.get_boolean('attach-modal-dialogs')")
    shell_proxy.eval(f"{MUTTER}.set_boolean('attach-modal-dialogs', false)")
    yield
    shell_proxy.eval(
        f"{MUTTER}.set_boolean('attach-modal-dialogs', {'true' if prior is True else 'false'})"
    )


class TestDialogPlacement:
    """A dialog that lands on its parent's tiled neighbour is moved back over its
    parent (forge-2ew, _repositionOccludedDialog in processFloats)."""

    def test_dialog_on_neighbour_moves_over_parent(
        self, shell_proxy, window_helper, detached_dialogs, two_windows
    ):
        left, right = sorted(two_windows, key=lambda w: _main_window_rect(shell_proxy, w)["x"])
        right_rect = as_rect(_main_window_rect(shell_proxy, right))
        dialog = _dialog_title(left)

        _open_dialog(shell_proxy, window_helper, left)
        dx, dy, dw, dh = _rect_of(shell_proxy, dialog)
        assert overlap_area((dx, dy, dw, dh), right_rect) == 0, (
            f"dialog {(dx, dy, dw, dh)} opened over the neighbour {right_rect}"
        )

        # Put the dialog on the neighbour without a grab, as a misplacement would.
        rx, ry, rw, rh = right_rect
        landed = shell_proxy.move_window_frame(dialog, rx + (rw - dw) // 2, ry + (rh - dh) // 2)
        assert overlap_area(as_rect(landed), right_rect) > 0, (
            f"the dialog did not move onto the neighbour: {landed}"
        )

        shell_proxy.request_render()
        shell_proxy.wait_for_forge_settled()
        moved = wait_for(
            lambda: _rect_of(shell_proxy, dialog),
            predicate=lambda r: overlap_area(r, right_rect) == 0,
            message="the dialog stayed on the neighbour",
        )
        px, py, pw, ph = as_rect(_main_window_rect(shell_proxy, left))
        cx, cy = moved[0] + moved[2] / 2, moved[1] + moved[3] / 2
        assert px <= cx <= px + pw and py <= cy <= py + ph, (
            f"dialog {moved} should be centred over its parent {(px, py, pw, ph)}"
        )
