"""Maximize in tile: a tiled window with a neighbour can be maximized.

The title-bar button or a double-click on the title bar maximizes a tiled window that
shares its monitor with other tiled windows. Forge keeps the maximize while the
window has focus and keeps it in its tile, so focusing the neighbour puts it
back in its slot. A single-axis edge-snap is still rejected (#461).
"""

from framework.constants import Timing
from framework.wait import wait_for

_MAXIMIZE_FOCUSED_JS = (
    "(function(){"
    "const Meta=imports.gi.Meta;"
    "const w=global.display.get_focus_window();"
    "if(!w) return 'none';"
    "if(typeof w.set_maximize_flags==='function') w.maximize();"
    "else w.maximize(Meta.MaximizeFlags.BOTH);"
    "return 'ok';"
    "})();"
)

_FOCUS_OTHER_JS = (
    "(function(){"
    "const f=global.display.get_focus_window();"
    "const ws=global.workspace_manager.get_active_workspace();"
    "const o=ws.list_windows().find(w=>w!==f&&w.get_window_type()===0);"
    "if(!o) return 'none';"
    "o.activate(global.get_current_time());"
    "return 'ok';"
    "})();"
)


def _is_maximized_js(window_id: int) -> str:
    return (
        "(function(){"
        f"const w=global.display.list_all_windows().find(w=>w.get_id()==={window_id});"
        "if(!w) return 'none';"
        "const f=typeof w.get_maximize_flags==='function'?"
        "w.get_maximize_flags():w.get_maximized();"
        "return f===3?'yes':'no';"
        "})();"
    )


class TestMaximizeInTile:
    def test_maximized_window_keeps_its_tile_until_focus_moves(
        self, shell_proxy, restore_settings, two_windows
    ):
        shell_proxy.ensure_focus()
        ws_width = shell_proxy.get_workspace_rect()["width"]
        focused = shell_proxy.get_focused_window()
        window_id = focused["id"]
        assert focused["rect"]["width"] < ws_width * 0.75, (
            f"expected a tiled half before maximizing, got {focused['rect']}"
        )

        assert shell_proxy.eval(_MAXIMIZE_FOCUSED_JS) == "ok"
        wait_for(
            lambda: shell_proxy.get_focused_window()["rect"],
            predicate=lambda r: r["width"] >= ws_width * 0.95,
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="window did not maximize",
        )
        shell_proxy.wait_for_forge_settled()

        assert shell_proxy.eval(_is_maximized_js(window_id)) == "yes", (
            "Forge reverted the maximize of the focused tiled window"
        )
        assert not shell_proxy.is_focused_window_floating(), (
            "the maximized window was floated out of its tile"
        )

        assert shell_proxy.eval(_FOCUS_OTHER_JS) == "ok"
        wait_for(
            lambda: shell_proxy.eval(_is_maximized_js(window_id)),
            predicate=lambda v: v == "no",
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="the maximize was kept after focus moved to the neighbour",
        )
        shell_proxy.wait_for_forge_settled()

        rect = next(w["rect"] for w in shell_proxy.get_windows() if w["id"] == window_id)
        assert rect["width"] < ws_width * 0.75, (
            f"the window did not return to its tile slot: {rect}"
        )
