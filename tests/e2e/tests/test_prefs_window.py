"""
The prefs window opens titled "Forge Settings", floats, and a second PrefsOpen
reuses it (forge-cxxo, forge-movq).

GNOME Shell opens an extension's prefs in the D-Bus-activated
org.gnome.Shell.Extensions service, which needs the display in the bus's
activation environment (start-user-session.sh sets it).
"""

import json

import pytest
from framework.wait import wait_for

# lib/shared/settings.js PREFS_TITLE and PREFS_WM_CLASS
PREFS_TITLE = "Forge Settings"
PREFS_WM_CLASS = "org.gnome.Shell.Extensions"

# GTK4/libadwaita starting on llvmpipe can take a long time to map its first window.
PREFS_OPEN_TIMEOUT = 60


def _prefs_window_ids(shell_proxy):
    return shell_proxy.eval(
        "JSON.stringify(global.display.list_all_windows().filter((w) => w.get_wm_class() === %s"
        " && w.get_title() === %s).map((w) => w.get_id()))"
        % (json.dumps(PREFS_WM_CLASS), json.dumps(PREFS_TITLE))
    )


def _focused_window_id(shell_proxy):
    return shell_proxy.eval("global.display.get_focus_window()?.get_id() ?? null")


@pytest.fixture
def close_prefs(shell_proxy, clean_workspace):
    """Close the prefs window after the test and wait until it is gone."""
    yield
    shell_proxy.eval(
        "global.display.list_all_windows().filter((w) => w.get_wm_class() === %s)"
        ".forEach((w) => w.delete(global.display.get_current_time_roundtrip()))"
        % json.dumps(PREFS_WM_CLASS)
    )
    wait_for(
        lambda: _prefs_window_ids(shell_proxy),
        predicate=lambda ids: ids == [],
        message="the prefs window did not close",
    )


def test_prefs_window_floats_and_opens_once(shell_proxy, close_prefs, launch_window):
    shell_proxy.invoke_forge_action({"name": "PrefsOpen"})
    ids = wait_for(
        lambda: _prefs_window_ids(shell_proxy),
        predicate=lambda ids: len(ids) == 1,
        timeout=PREFS_OPEN_TIMEOUT,
        interval=1.0,
        message=f"no {PREFS_WM_CLASS} window titled {PREFS_TITLE!r} opened",
    )
    shell_proxy.wait_for_forge_settled()
    assert shell_proxy.is_window_floating(PREFS_WM_CLASS), "the prefs window should float"

    # Another window takes focus, so the second PrefsOpen has to bring the prefs back.
    launch_window()
    assert _focused_window_id(shell_proxy) != ids[0], "the test window did not take focus"
    shell_proxy.invoke_forge_action({"name": "PrefsOpen"})
    wait_for(
        lambda: _focused_window_id(shell_proxy),
        predicate=lambda focused: focused == ids[0],
        message="a second PrefsOpen did not focus the open prefs window",
    )
    assert _prefs_window_ids(shell_proxy) == ids, "a second PrefsOpen opened another prefs window"
