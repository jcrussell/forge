"""Fullscreen-with-sibling regression (forge-fw8, gh-509).

When a tiled window goes fullscreen while a second app is open, Forge's
in-fullscreen-changed -> renderTree -> tree.apply() used to re-slice the
fullscreen window to its half-width split rect (shifting it right / cropping it).
The fix excludes fullscreen windows from apply()'s slice application, so a
fullscreen window keeps Mutter's full-monitor geometry.

Behavioral assertion: a fullscreen window's frame rect spans (nearly) the whole
work area width, not the ~half-width tile slice it had before going fullscreen.
"""

from framework.constants import Timing
from framework.wait import wait_for


def _make_focused_fullscreen(shell_proxy) -> str:
    return shell_proxy.eval(
        "(function(){"
        "let w=global.display.get_focus_window();"
        "if(!w) return 'none';"
        "w.make_fullscreen();"
        "return 'ok';"
        "})();"
    )


class TestFullscreenTiled:
    def test_fullscreen_window_fills_monitor_with_sibling(
        self, shell_proxy, restore_settings, two_windows
    ):
        """A fullscreen tiled window is not re-sliced to its half-width tile slot."""
        shell_proxy.ensure_focus()

        ws = shell_proxy.get_workspace_rect()
        ws_width = ws["width"]

        # Precondition: the focused window is a tiled half (well under full width).
        before = shell_proxy.get_focused_window()["rect"]
        assert before["width"] < ws_width * 0.75, (
            f"expected a tiled (sub-full-width) window before fullscreen, got {before}"
        )

        assert _make_focused_fullscreen(shell_proxy) == "ok"

        # After fullscreen + Forge's render, the window must span ~the full width,
        # NOT the ~half-width split slice it occupied while tiled.
        rect = wait_for(
            lambda: shell_proxy.get_focused_window()["rect"],
            predicate=lambda r: r["width"] >= ws_width * 0.95,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="fullscreen window was re-sliced to its tile slot instead of filling the monitor",
        )
        assert rect["width"] >= ws_width * 0.95
