"""
Moving a window out of its container lays the split out soundly (#549).

When Move takes a window out of its container to the level above (nothing lies
in that direction to move into), the window must land in that split and the
windows must still fill the workspace without overlapping or running off it.
The shares themselves are not checked: computeSizes scales a split's shares to
fill it, so they need not sum to 1. Also checks what Move must not change: Move
on a window with nothing in that direction and no container to leave keeps every
window where it is, and a container emptied by the move leaves no gap.

Ported from PR #3's nested-shell scenario 14_move_out_shares.
"""

import pytest
from framework.constants import Tolerance
from framework.geometry import as_rect, layout_fill_error
from framework.workflow import invoke_resize


def _by_x(shell_proxy):
    return sorted(shell_proxy.get_windows(), key=lambda w: w["rect"]["x"])


def _containers(shell_proxy):
    """The titles of the windows directly in each CON of the tree, as sets."""
    found = []

    def walk(node):
        children = node.get("children") or []
        if node.get("nodeType") == "CON":
            found.append({c["windowTitle"] for c in children if c["nodeType"] == "WINDOW"})
        for child in children:
            walk(child)

    walk(shell_proxy.get_forge_tree())
    return found


def _parent(tree, title):
    """The node that holds the window titled `title` directly."""

    def walk(node):
        for child in node.get("children") or []:
            if child.get("nodeType") == "WINDOW" and child.get("windowTitle") == title:
                return node
            found = walk(child)
            if found is not None:
                return found
        return None

    return walk(tree)


def _split(shell_proxy, title):
    shell_proxy.activate_window(title)
    shell_proxy.invoke_forge_action({"name": "Split", "orientation": "horizontal"})
    shell_proxy.wait_for_forge_settled()


def _resize(shell_proxy, title, amount):
    """Move the right edge of `title` by about 2 * amount px."""
    shell_proxy.activate_window(title)
    invoke_resize(shell_proxy, "WindowResizeRight", count=2, amount=amount)
    shell_proxy.wait_for_layout_landed()


def _move(shell_proxy, title, direction):
    shell_proxy.activate_window(title)
    shell_proxy.invoke_forge_action({"name": "Move", "direction": direction})
    shell_proxy.wait_for_layout_landed()


def _assert_layout_sound(shell_proxy):
    report = shell_proxy.fuzz_check_invariants()
    assert report["valid"], report["violations"]
    rects = [as_rect(w["rect"]) for w in shell_proxy.get_windows()]
    error = layout_fill_error(rects, as_rect(shell_proxy.get_workspace_rect()))
    assert error is None, error


class TestMoveOutShares:
    @pytest.fixture(autouse=True)
    def _settings(self, restore_settings):
        # New windows join the focused window's split.
        restore_settings.set("auto-split-enabled", False)
        restore_settings.set("move-pointer-focus-enabled", False)

    def _setup(self, shell_proxy, launch_window, container_last=False):
        """A | B at unequal shares, then C joins A in a container, also unequal:
        HSPLIT[HSPLIT[A, C], B], or HSPLIT[B, HSPLIT[A, C]] with container_last
        (A is then the right-hand window). Returns the titles of A, B and C."""
        launch_window()
        launch_window()
        left, right = (w["title"] for w in _by_x(shell_proxy))
        _resize(shell_proxy, left, 60)
        a, b = (right, left) if container_last else (left, right)
        _split(shell_proxy, a)
        c = launch_window()["title"]
        _resize(shell_proxy, a, -30)
        assert {a, c} in _containers(shell_proxy), "C did not join A's container"
        return a, b, c

    @pytest.mark.parametrize("direction", ["Up", "Down"])
    def test_move_out_of_container(self, shell_proxy, launch_window, direction):
        a, b, c = self._setup(shell_proxy, launch_window)
        _move(shell_proxy, c, direction)
        tree = shell_proxy.get_forge_tree()
        assert {a, c} not in _containers(shell_proxy), f"C is still in A's container: {tree}"
        top = _parent(tree, b)
        assert top is not None and _parent(tree, c) is top, (
            f"C is not in the top-level split: {tree}"
        )
        _assert_layout_sound(shell_proxy)

    @pytest.mark.multimonitor
    def test_move_out_towards_other_monitor(self, shell_proxy, launch_window):
        """With a monitor to the right, Move Right on C in HSPLIT[B, HSPLIT[A, C]]
        takes C out of its container onto this monitor's level."""
        if shell_proxy.get_monitor_count() < 2:
            pytest.skip("needs a second monitor")
        _, _, c = self._setup(shell_proxy, launch_window, container_last=True)
        _move(shell_proxy, c, "Right")
        # get_windows() also lists the other monitor's windows, so check where C is.
        x, y, width, height = as_rect(
            next(w for w in shell_proxy.get_windows() if w["title"] == c)["rect"]
        )
        ax, ay, aw, ah = as_rect(shell_proxy.get_workspace_rect())
        cx, cy = x + width / 2, y + height / 2
        assert ax <= cx < ax + aw and ay <= cy < ay + ah, "C left the primary monitor"
        _assert_layout_sound(shell_proxy)

    def test_move_at_edge_keeps_places(self, shell_proxy, launch_window):
        """Move Up on a top-level window with nothing above leaves both windows
        where they are, at their sizes."""
        launch_window()
        launch_window()
        a = _by_x(shell_proxy)[0]["title"]
        _resize(shell_proxy, a, 60)
        before = [w["rect"] for w in _by_x(shell_proxy)]

        _move(shell_proxy, a, "Up")

        after = [w["rect"] for w in _by_x(shell_proxy)]
        for old, new in zip(before, after):
            for key in ("x", "width"):
                assert abs(old[key] - new[key]) <= Tolerance.POSITION, f"{before} -> {after}"

    def test_emptied_container_leaves_no_gap(self, shell_proxy, launch_window):
        """Move Up on W in HSPLIT[HSPLIT[HSPLIT[W], X], Y] empties W's container;
        X takes all of it."""
        launch_window()
        launch_window()
        w = _by_x(shell_proxy)[0]["title"]
        _split(shell_proxy, w)
        launch_window()
        _split(shell_proxy, w)
        _resize(shell_proxy, w, -30)
        assert {w} in _containers(shell_proxy), "W is not alone in a nested container"
        cons_before = len(_containers(shell_proxy))

        _move(shell_proxy, w, "Up")

        tree = shell_proxy.get_forge_tree()
        assert len(_containers(shell_proxy)) == cons_before - 1, (
            f"W's container is still there: {tree}"
        )
        _assert_layout_sound(shell_proxy)
