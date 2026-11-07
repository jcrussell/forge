"""forge-zhms: a tab/stack bar must not paint over an unrelated float covering it.

DecorationManager.updateDecorationLayout restacked every tab/stack bar directly
below the FOCUSED window's actor, so focusing an unrelated tiled window lifted a
container's bar over a float stacked above that container. Mutter's restack
(sync_actor_stacking lowers every window actor in turn) also left the bars, which
are not window actors, above every window until Forge rendered again.

Each bar is now anchored just below its own container's topmost window, and
re-anchored on display::restacked. A mocked window_group cannot show the Mutter
restack, so this compares the real window_group child order.
"""

import time

from framework.constants import Timing
from framework.wait import wait_for, wait_for_layout

FLOAT_TOGGLE = {
    "name": "FloatToggle",
    "mode": "float",
    "x": "center",
    "y": "center",
    "width": 0.4,
    "height": 0.4,
}

_PRELUDE = r"""
  const ext = Main.extensionManager.lookup('forge@jmmaranan.com').stateObj;
  const wm = ext && ext.extWm;
  if (!wm) return JSON.stringify({err: 'no-wm'});
  const con = wm.tree.getNodeByLayout('TABBED').find((c) => c.decoration);
  if (!con) return JSON.stringify({err: 'no-tabbed-con'});
  const inCon = new Set(con.getNodeByType('WINDOW').map((n) => n.nodeValue));
  const others = wm.tree.getNodeByType('WINDOW').filter((n) => !inCon.has(n.nodeValue));
  const float = others.find((n) => n.isFloat());
  const tiled = others.find((n) => n.isTile());
"""

# Put the float over the tabbed container's bar and raise it above the container.
_COVER_BAR = (
    "(() => {"
    + _PRELUDE
    + r"""
  if (!float) return JSON.stringify({err: 'no-float'});
  const d = con.decoration;
  const fw = float.nodeValue;
  fw.move_resize_frame(true, Math.round(d.x), Math.round(d.y), 400, 300);
  fw.activate(global.get_current_time());
  return JSON.stringify({ok: true});
})()"""
)

# Focus the tiled window that is in neither the container nor the float.
_FOCUS_UNRELATED = (
    "(() => {"
    + _PRELUDE
    + r"""
  if (!tiled) return JSON.stringify({err: 'no-unrelated-tiled'});
  tiled.nodeValue.activate(global.get_current_time());
  return JSON.stringify({ok: true});
})()"""
)

_PROBE = (
    "(() => {"
    + _PRELUDE
    + r"""
  if (!float || !tiled) return JSON.stringify({err: 'missing'});
  const d = con.decoration;
  const fr = float.nodeValue.get_frame_rect();
  const overlaps = fr.x < d.x + d.width && d.x < fr.x + fr.width &&
    fr.y < d.y + d.height && d.y < fr.y + fr.height;
  const children = global.window_group.get_children();
  return JSON.stringify({
    focusedUnrelated: global.display.get_focus_window() === tiled.nodeValue,
    decoVisible: d.visible,
    overlaps,
    decoIndex: children.indexOf(d),
    floatIndex: children.indexOf(float.nodeValue.get_compositor_private()),
  });
})()"""
)


def _eval_json(shell_proxy, js):
    result = shell_proxy.eval(js)
    assert isinstance(result, dict) and "err" not in result, f"probe failed: {result!r}"
    return result


class TestDecorationStacking:
    def test_tab_bar_stays_under_a_float_covering_it(
        self, shell_proxy, restore_settings, three_windows
    ):
        restore_settings.set_float_always_on_top(False)
        restore_settings.set_tabbed_tiling_mode_enabled(True)
        time.sleep(Timing.SETTINGS_SETTLE)

        # The leftmost window gets a (single-child) TABBED container with a bar.
        shell_proxy.invoke_forge_action(
            {"name": "LayoutTabbedToggle"}, focus_window="leftmost", also_activate=True
        )
        wait_for_layout(shell_proxy, "TABBED")
        shell_proxy.wait_for_forge_settled()

        # The rightmost window floats, then covers the bar from above.
        shell_proxy.invoke_forge_action(FLOAT_TOGGLE, focus_window="rightmost")
        shell_proxy.wait_for_forge_settled()
        _eval_json(shell_proxy, _COVER_BAR)
        shell_proxy.wait_for_forge_settled()

        # Focusing the remaining tiled window restacks (Mutter) and re-lays out (Forge).
        _eval_json(shell_proxy, _FOCUS_UNRELATED)
        state = wait_for(
            lambda: _eval_json(shell_proxy, _PROBE),
            predicate=lambda s: s["focusedUnrelated"] and s["decoVisible"],
            timeout=Timing.LAYOUT_CHANGE * 6,
            message="unrelated tiled window never took focus with the bar shown",
        )
        assert state["overlaps"], f"precondition: the float must cover the bar: {state}"
        shell_proxy.wait_for_forge_settled()

        state = _eval_json(shell_proxy, _PROBE)
        assert state["decoIndex"] >= 0 and state["floatIndex"] >= 0, state
        assert state["decoIndex"] < state["floatIndex"], (
            f"the tab bar is stacked over the float covering it: {state}"
        )
