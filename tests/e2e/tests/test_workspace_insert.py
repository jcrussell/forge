"""
E2E for forge-6pe: inserting a workspace (GNOME overview drag-to-create) must not
scramble the tiling of the windows that GNOME shifts to the next workspace.

GNOME's WindowManager.insertWorkspace(pos) appends a new workspace at the END and
then, in a synchronous loop, moves every window at index >= pos to index+1 via
change_workspace_by_index (which emits each window's workspace-changed
synchronously). Forge must re-home those windows while preserving their layout
(here: their custom-resized proportions), not re-equalize / flatten them.

This test reproduces insertWorkspace's exact Meta calls via Eval so the real
synchronous signal timing is exercised against the real extension.
"""

import time

import pytest

from framework.constants import Timing
from framework.wait import wait_for, wait_for_stable, wait_for_window_count


INSERT_WORKSPACE_JS = """
(function() {
    var wsm = global.workspace_manager;
    var pos = wsm.get_active_workspace_index();
    wsm.append_new_workspace(false, global.get_current_time());
    var windows = global.get_window_actors().map(function(a){ return a.meta_window; });
    windows.forEach(function(w){
        if (w.get_transient_for() != null) return;
        if (w.is_override_redirect && w.is_override_redirect()) return;
        if (w.on_all_workspaces) return;
        var idx = w.get_workspace().index();
        if (idx < pos) return;
        w.change_workspace_by_index(idx + 1, true);
    });
    var dest = wsm.get_workspace_by_index(pos + 1);
    if (dest) dest.activate(global.get_current_time());
    return 'OK';
})();
"""


# forge-t3bb: INSERT_WORKSPACE_JS permanently grows the workspace count and
# shifts the active index — the session pins dynamic-workspaces=false (see
# start-user-session.sh), so GNOME never removes the extra workspace, and
# clean_workspace only sweeps the CURRENT workspace. Bring every window back to
# the original workspace, drop the appended workspaces, and restore the active
# index, so later tests (and clean_workspace's teardown sweep) see the same
# session they would without this module.
RESTORE_WORKSPACES_JS = """
(function() {
    var wsm = global.workspace_manager;
    var keep = %d;
    var active = %d;
    global.get_window_actors().map(function(a){ return a.meta_window; }).forEach(function(w){
        if (w.get_transient_for() != null) return;
        if (w.is_override_redirect && w.is_override_redirect()) return;
        if (w.on_all_workspaces) return;
        var ws = w.get_workspace();
        if (ws && ws.index() !== active) w.change_workspace_by_index(active, false);
    });
    for (var i = wsm.get_n_workspaces() - 1; i >= keep; i--) {
        var ws = wsm.get_workspace_by_index(i);
        if (ws) wsm.remove_workspace(ws, global.get_current_time());
    }
    var dest = wsm.get_workspace_by_index(active);
    if (dest) dest.activate(global.get_current_time());
    return 'OK';
})();
"""


@pytest.fixture(autouse=True)
def _restore_workspaces(shell_proxy):
    initial_count = int(shell_proxy.eval("global.workspace_manager.get_n_workspaces()"))
    initial_index = shell_proxy.get_active_workspace_index()
    yield
    shell_proxy.eval(RESTORE_WORKSPACES_JS % (initial_count, initial_index))
    wait_for(
        shell_proxy.get_active_workspace_index,
        predicate=lambda i: i == initial_index,
    )


def _max_subsplit_con_children(tree):
    """Largest child count among non-monitor CON containers holding >= 2 windows.

    A genuine nested sub-split shows up as a CON (not the monitor container) whose
    children are windows. Returns 0 if there is no such nesting (flat layout).
    """
    best = 0

    def walk(node, depth):
        nonlocal best
        if not isinstance(node, dict):
            return
        children = node.get("children") or []
        if node.get("nodeType") == "CON" and depth >= 2:
            win_children = [c for c in children if c.get("nodeType") == "WINDOW"]
            if len(win_children) >= 2:
                best = max(best, len(win_children))
        for c in children:
            walk(c, depth + 1)

    walk(tree, 0)
    return best


class TestWorkspaceInsertPreservesLayout:
    def test_insert_workspace_preserves_resized_proportions(
        self, shell_proxy, window_helper, two_windows
    ):
        from framework.workflow import invoke_resize

        wait_for_window_count(shell_proxy, 2)

        # Make the two windows unequal so re-equalization would be visible.
        invoke_resize(shell_proxy, "WindowResizeRight", focus_window="leftmost")
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))

        before = window_helper.get_windows_sorted_by_position("x")
        widths_before = [w.get("rect", {}).get("width", 0) for w in before]
        assert len(widths_before) == 2 and all(widths_before), f"bad setup: {widths_before}"
        ratio_before = widths_before[0] / widths_before[1]
        # Sanity: the resize actually made them unequal.
        assert abs(ratio_before - 1.0) > 0.15, (
            f"windows not unequal enough to test: {widths_before}"
        )

        start_ws = shell_proxy.get_active_workspace_index()

        # Simulate GNOME insertWorkspace at the active position: both windows shift
        # to start_ws+1, which is then activated.
        shell_proxy.eval(INSERT_WORKSPACE_JS)
        wait_for(
            shell_proxy.get_active_workspace_index,
            predicate=lambda i: i == start_ws + 1,
        )
        wait_for_window_count(shell_proxy, 2)
        wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
        time.sleep(Timing.WINDOW_SETTLE)

        after = window_helper.get_windows_sorted_by_position("x")
        widths_after = [w.get("rect", {}).get("width", 0) for w in after]
        assert len(widths_after) == 2 and all(widths_after), (
            f"windows missing after insert: {widths_after}"
        )
        ratio_after = widths_after[0] / widths_after[1]

        assert abs(ratio_before - ratio_after) < 0.15, (
            f"proportions scrambled by workspace insert: "
            f"before={widths_before} (ratio {ratio_before:.2f}) -> "
            f"after={widths_after} (ratio {ratio_after:.2f})"
        )

    def test_insert_workspace_preserves_nested_subsplit(
        self, shell_proxy, launch_window
    ):
        # Build: A | (B / C)  -> a VSPLIT sub-container holding B and C beside A.
        launch_window()
        time.sleep(Timing.WINDOW_SETTLE)
        launch_window()
        time.sleep(Timing.WINDOW_SETTLE)
        wait_for_window_count(shell_proxy, 2)

        # Split the focused window vertically, then open a third window so it nests.
        shell_proxy.invoke_forge_action({"name": "Split", "orientation": "vertical"})
        time.sleep(Timing.WINDOW_SETTLE)
        launch_window()
        time.sleep(Timing.WINDOW_SETTLE)
        wait_for_window_count(shell_proxy, 3)
        time.sleep(Timing.WINDOW_SETTLE)

        tree_before = shell_proxy.get_forge_tree()
        nested_before = _max_subsplit_con_children(tree_before)
        # Precondition: we actually built a nested sub-split. If not, skip rather
        # than assert a false negative about the bug.
        if nested_before < 2:
            pytest.skip(f"could not construct a nested sub-split; tree={tree_before}")

        start_ws = shell_proxy.get_active_workspace_index()
        shell_proxy.eval(INSERT_WORKSPACE_JS)
        wait_for(
            shell_proxy.get_active_workspace_index,
            predicate=lambda i: i == start_ws + 1,
        )
        wait_for_window_count(shell_proxy, 3)
        wait_for_stable(lambda: shell_proxy.get_forge_tree())
        time.sleep(Timing.WINDOW_SETTLE)

        tree_after = shell_proxy.get_forge_tree()
        nested_after = _max_subsplit_con_children(tree_after)

        assert nested_after >= nested_before, (
            f"nested sub-split flattened by workspace insert: "
            f"nested_before={nested_before} -> nested_after={nested_after}\n"
            f"tree_after={tree_after}"
        )
