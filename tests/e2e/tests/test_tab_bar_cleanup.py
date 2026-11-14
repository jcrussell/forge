"""
A tabbed container's tab bar leaves the screen with the container (#548).

Each test builds A | TABBED[B, C, D] and takes the group apart a different way:
closing its windows one by one or all at once, moving them out, or toggling
tabbed off. The group must leave the tree, and no tab bar may stay visible for
a container that has left the tree, is no longer tabbed or holds no window
(ShellProxy.get_stray_tab_bars).

Ported from PR #3's nested-shell scenario 06_stale_tab_bar.
"""

import json

import pytest
from framework.wait import wait_for


def _tabbed_groups(node):
    """Window titles of each TABBED container in the tree dict, in order (an
    empty TABBED container counts, as [])."""
    groups = []
    if node.get("layout") == "TABBED":
        groups.append([c["windowTitle"] for c in node["children"] if c["nodeType"] == "WINDOW"])
    for child in node.get("children") or []:
        groups += _tabbed_groups(child)
    return groups


def _wait_for_groups(shell_proxy, expected):
    return wait_for(
        lambda: _tabbed_groups(shell_proxy.get_forge_tree()),
        predicate=lambda groups: sorted(map(sorted, groups)) == sorted(map(sorted, expected)),
        message=f"tabbed groups did not become {expected}",
    )


def _build_group(shell_proxy, launch_window):
    """A | TABBED[B, C, D]; returns the titles of B, C and D."""
    launch_window()
    b = launch_window()
    shell_proxy.invoke_forge_action(
        {"name": "Split", "orientation": "vertical"}, focus_window="rightmost", also_activate=True
    )
    shell_proxy.wait_for_forge_settled()
    c, d = launch_window(), launch_window()
    shell_proxy.invoke_forge_action({"name": "LayoutTabbedToggle"}, focus_window="rightmost")
    titles = [w["title"] for w in (b, c, d)]
    _wait_for_groups(shell_proxy, [titles])
    shell_proxy.wait_for_forge_settled()
    return titles


def _close(shell_proxy, titles):
    """Close the windows titled `titles` in one eval and wait until they are gone."""
    shell_proxy.eval(
        "global.display.list_all_windows().filter((w) => %s.includes(w.get_title()))"
        ".forEach((w) => w.delete(global.display.get_current_time_roundtrip()))"
        % json.dumps(titles)
    )
    wait_for(
        shell_proxy.get_windows,
        predicate=lambda ws: not any(w["title"] in titles for w in ws),
        message=f"{titles} did not close",
    )
    shell_proxy.wait_for_forge_settled()


def _assert_no_stray_bars(shell_proxy, when):
    bars = shell_proxy.get_stray_tab_bars()
    assert bars == [], f"tab bars left on screen {when}: {bars}"


class TestTabBarCleanup:
    @pytest.fixture(autouse=True)
    def _settings(self, restore_settings):
        restore_settings.set_tabbed_tiling_mode_enabled(True)
        # New windows join the focused window's container.
        restore_settings.set("auto-split-enabled", False)

    def test_close_tabs_one_by_one(self, shell_proxy, launch_window):
        titles = _build_group(shell_proxy, launch_window)

        _close(shell_proxy, titles[:1])
        _wait_for_groups(shell_proxy, [titles[1:]])
        tabs = shell_proxy.eval(
            "globalThis._forgeTestBridge.root().getNodeByType('CON')"
            ".find((c) => c.isTabbed()).decoration.get_n_children()"
        )
        assert tabs == 2, f"the tab bar should show the 2 remaining tabs, shows {tabs}"
        _assert_no_stray_bars(shell_proxy, "after closing 1 of 3 tabs")

        for title in titles[1:]:
            _close(shell_proxy, [title])
            _assert_no_stray_bars(shell_proxy, f"after closing {title}")
        _wait_for_groups(shell_proxy, [])

    def test_close_tabs_together(self, shell_proxy, launch_window):
        titles = _build_group(shell_proxy, launch_window)

        _close(shell_proxy, titles)
        _wait_for_groups(shell_proxy, [])
        _assert_no_stray_bars(shell_proxy, "after closing all 3 tabs at once")

    def test_move_tabs_out(self, shell_proxy, launch_window):
        titles = _build_group(shell_proxy, launch_window)

        for title in titles:
            shell_proxy.activate_window(title)
            shell_proxy.invoke_forge_action({"name": "Move", "direction": "Left"})
            shell_proxy.wait_for_forge_settled()
        _wait_for_groups(shell_proxy, [])
        _assert_no_stray_bars(shell_proxy, "after moving every window out of the group")

    def test_toggle_tabbed_off(self, shell_proxy, launch_window):
        titles = _build_group(shell_proxy, launch_window)

        shell_proxy.activate_window(titles[-1])
        shell_proxy.invoke_forge_action({"name": "LayoutTabbedToggle"})
        _wait_for_groups(shell_proxy, [])
        shell_proxy.wait_for_forge_settled()
        _assert_no_stray_bars(shell_proxy, "after toggling tabbed off")
