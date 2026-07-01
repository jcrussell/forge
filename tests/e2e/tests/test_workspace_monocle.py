"""
Workspace monocle toggle tests for Forge (forge-a34.7).

WorkspaceMonocleToggle moves every tiled window on the active workspace's first
monitor into ONE tabbed container, so the focused window fills the work area and
the others stack behind it (same rect). Toggling again restores a split layout
(determineSplitLayout returns HSPLIT/VSPLIT only).

We assert via window rects rather than get_container_layout (which is
focus-dependent and flaky under Xvfb) and avoid a strict full-height check: a
tabbed container offsets/shrinks the window by the ~35px tab bar, which exceeds
the size tolerance. Instead we assert the two windows collapse onto (≈) the same
rect spanning ~full width, and separate again on toggle-off.

The monocle keybinding is unbound by default, so dispatch is the forge action
via the default dbus lane.
"""

import signal

import pytest
from framework.constants import Tolerance
from framework.wait import wait_for, wait_for_stable

MONOCLE_ACTION = {"name": "WorkspaceMonocleToggle"}

# Upper bound (seconds) for any single monocle test. Normal runs finish in a few
# seconds; this only trips on a hang.
_MONOCLE_TIMEOUT = 30


@pytest.fixture(autouse=True)
def _bound_monocle_runtime():
    """Fail fast instead of hanging if the self-append recursion regresses (forge-0mf).

    A regressed enter path recurses in renderTree; the synchronous D-Bus eval then
    blocks (up to the proxy's ~25s default) and the shell may crash, only surfacing
    on the NEXT test via _check_shell_alive. A SIGALRM keeps the bound low and the
    failure legible — and needs no extra test dependency (stdlib only; pytest runs
    tests in the main thread, so the alarm interrupts the blocking call here).
    """

    def _on_timeout(signum, frame):
        raise TimeoutError(
            "monocle test exceeded its time budget — possible self-append recursion hang"
        )

    previous = signal.signal(signal.SIGALRM, _on_timeout)
    signal.alarm(_MONOCLE_TIMEOUT)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def _editor_rects(shell_proxy, wm_class):
    """Return rect dicts for every window of wm_class on the workspace."""
    wins = shell_proxy.get_windows()
    if not isinstance(wins, list):
        return []
    return [w.get("rect", {}) for w in wins if w.get("wmClass") == wm_class]


def _rect_tuple(rect):
    return (
        rect.get("x", 0),
        rect.get("y", 0),
        rect.get("width", 0),
        rect.get("height", 0),
    )


def _x_spread(rects):
    """Horizontal distance between the two windows' left edges."""
    xs = sorted(r.get("x", 0) for r in rects)
    return xs[-1] - xs[0]


class TestWorkspaceMonocle:
    def test_monocle_collapses_windows_onto_one_area(self, shell_proxy, window_helper, two_windows):
        """Monocle should stack both windows on (≈) the same full-width rect."""
        wm_class = two_windows[0].get("wmClass")
        workspace = window_helper.get_workspace_rect()

        # Baseline: two windows tiled side-by-side (distinct x positions).
        wait_for_stable(lambda: _editor_rects(shell_proxy, wm_class))
        base_rects = _editor_rects(shell_proxy, wm_class)
        assert len(base_rects) == 2
        assert _x_spread(base_rects) > workspace["width"] * 0.25, (
            "windows should start side-by-side (HSPLIT)"
        )

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action(MONOCLE_ACTION)

        # In monocle the two windows share the container rect (x spread ~0) and
        # the container fills the work-area width. renderTree settles in stages
        # (the x collapse can land a frame before the width grows), so the
        # predicate waits for BOTH conditions to avoid reading a mid-render rect.
        rects = wait_for(
            lambda: _editor_rects(shell_proxy, wm_class),
            predicate=lambda rs: (
                len(rs) == 2
                and _x_spread(rs) < Tolerance.POSITION
                and all(r.get("width", 0) > workspace["width"] * 0.9 for r in rs)
            ),
            message="monocle did not collapse windows onto one full-width area",
        )
        r1, r2 = _rect_tuple(rects[0]), _rect_tuple(rects[1])
        # Both windows occupy (approximately) the same rect.
        for a, b in zip(r1, r2):
            assert abs(a - b) < Tolerance.SIZE, f"monocle windows differ: {r1} vs {r2}"
        # ...and that rect spans most of the work area width.
        assert r1[2] > workspace["width"] * 0.9, (
            f"monocle window should be ~full width: {r1[2]} vs {workspace['width']}"
        )

    def test_monocle_from_existing_container(
        self, shell_proxy, input_sim, window_helper, two_windows
    ):
        """Monocle must work (not hang) when windows already live in a container.

        Regression guard for the self-append cycle: the monitor's direct child
        is then a CON, and the original enter path appended that CON into itself
        (infinite renderTree recursion). Building a stacked group first puts both
        windows under a container so the enter path exercises that case; the
        leaf-window collection must still collapse them to one full-width tabbed
        container. A hang here would kill gnome-shell and trip _check_shell_alive.
        """
        wm_class = two_windows[0].get("wmClass")
        workspace = window_helper.get_workspace_rect()

        input_sim.toggle_stacked()
        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action(MONOCLE_ACTION)

        rects = wait_for(
            lambda: _editor_rects(shell_proxy, wm_class),
            predicate=lambda rs: (
                len(rs) == 2
                and _x_spread(rs) < Tolerance.POSITION
                and all(r.get("width", 0) > workspace["width"] * 0.9 for r in rs)
            ),
            message="monocle from a container did not collapse to one full-width area",
        )
        assert len(rects) == 2

    def test_monocle_toggle_off_restores_split(self, shell_proxy, window_helper, two_windows):
        """Toggling monocle off should restore a side-by-side split layout."""
        wm_class = two_windows[0].get("wmClass")
        workspace = window_helper.get_workspace_rect()

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action(MONOCLE_ACTION)
        wait_for(
            lambda: _editor_rects(shell_proxy, wm_class),
            predicate=lambda rs: len(rs) == 2 and _x_spread(rs) < Tolerance.POSITION,
            message="monocle did not engage",
        )

        shell_proxy.ensure_focus()
        shell_proxy.invoke_forge_action(MONOCLE_ACTION)
        rects = wait_for(
            lambda: _editor_rects(shell_proxy, wm_class),
            predicate=lambda rs: len(rs) == 2 and _x_spread(rs) > workspace["width"] * 0.25,
            message="monocle toggle-off did not restore a side-by-side split",
        )
        assert len(rects) == 2
        # Windows no longer share a rect.
        assert _x_spread(rects) > workspace["width"] * 0.25
