"""A Forge disable/enable cycle (forge-fhen.7).

disable() must drop every handler Forge connected. One left on a shell singleton
(display, window manager, workspace manager, settings, overview, keybindings) keeps
its torn-down WindowManager alive and runs whenever its signal fires: while Forge
is disabled, and again once enable() has given the extension object back its
settings, when the stale manager acts on a tree it no longer has. This drives each
of those sources with Forge disabled, re-enables it, writes the setting again, opens
a window, and checks the shell log stays free of Forge errors, the layout and borders
come back, and no stale manager has rebuilt a tree of its own.
"""

import json

from framework.constants import FORGE_UUID, Timeout
from framework.wait import wait_for, wait_for_layout_settled
from fuzz.engine import EXT_STATE_ACTIVE, EXT_STATE_INACTIVE, LogScanner

# A Gio.Settings of Forge's schema that is not the one Forge connected to, so a
# write still reaches any handler Forge left on its own instance.
FORGE_SETTINGS = "Main.extensionManager.lookup(%s).stateObj.getSettings()" % json.dumps(FORGE_UUID)

BORDER_COUNTS = r"""
(() => {
  const BORDER = /\bwindow-(tiled|stacked|tabbed|floated)-border\b/;
  const windows = global.workspace_manager.get_active_workspace().list_windows();
  const borders = global.window_group.get_children().filter((a) => {
    const cls = a.get_style_class_name ? a.get_style_class_name() : null;
    return !!cls && BORDER.test(cls);
  });
  const owned = windows.filter((w) => {
    const border = w.get_compositor_private()?.border;
    return !!border && borders.includes(border);
  });
  return JSON.stringify({ windows: windows.length, borders: borders.length, owned: owned.length });
})()
"""

# The St.Bins a Forge Tree adds to window_group for its root, monitors and
# workspaces (every non-border St.Bin there). A stale manager that handles a signal
# rebuilds a Tree through its `tree` getter, which adds another set.
TREE_BINS = r"""
(() => {
  const BORDER = /\bwindow-[a-z]+-border\b/;
  return String(global.window_group.get_children().filter((a) =>
    a.constructor.name === "St_Bin" && !BORDER.test(a.get_style_class_name() || "")).length);
})()
"""


def _set_forge_enabled(shell_proxy, enabled):
    shell_proxy.fuzz_ext_set_enabled(enabled)
    state = EXT_STATE_ACTIVE if enabled else EXT_STATE_INACTIVE
    wait_for(
        shell_proxy.fuzz_ext_state,
        predicate=lambda s: s == state,
        timeout=Timeout.DEFAULT,
        message=f"Forge did not reach extension state {state}",
    )


def _close_window_titled(shell_proxy, title):
    shell_proxy.eval(
        "global.get_window_actors().map((a) => a.meta_window)"
        ".find((w) => w.get_title() === %s).delete(global.get_current_time())" % json.dumps(title)
    )
    wait_for(
        shell_proxy.get_windows,
        predicate=lambda ws: all(w.get("title") != title for w in ws),
        message=f"window {title} did not close",
    )


def _minimize_and_restore(shell_proxy):
    # fuzz_window_state acts on the first window of the workspace. The window
    # manager's minimize signal can come after minimize() returns, and an immediate
    # unminimize can skip it (seen on Fedora 43), so wait for the actor to hide first.
    actor_visible = (
        "String(global.workspace_manager.get_active_workspace().list_windows()[0]"
        ".get_compositor_private().visible)"
    )
    for op, visible in (("minimize", "false"), ("unminimize", "true")):
        shell_proxy.fuzz_window_state(op)
        wait_for(
            lambda: shell_proxy.eval(actor_visible),
            predicate=lambda v, visible=visible: v == visible,
            message=f"{op} did not take effect",
        )


def _rewrite_gap(shell_proxy):
    gap = int(shell_proxy.eval(f"String({FORGE_SETTINGS}.get_uint('window-gap-size'))"))
    # window-gap-size ranges 0-32.
    other = gap - 1 if gap > 0 else gap + 1
    shell_proxy.eval(
        f"(() => {{ const s = {FORGE_SETTINGS};"
        f" s.set_uint('window-gap-size', {other});"
        f" s.set_uint('window-gap-size', {gap}); }})()"
    )


def _show_overview(shell_proxy):
    # The e2e session hides the overview on "showing" (start-user-session.sh), so
    # show() emits showing and hiding without it staying up.
    shell_proxy.eval("Main.overview.show()")
    wait_for(
        lambda: shell_proxy.eval(
            "String(Main.overview.visible || Main.overview.animationInProgress)"
        ),
        predicate=lambda v: v == "false",
        message="overview did not close",
    )


def test_disable_enable_cycle(shell_proxy, input_sim, window_helper, three_windows, launch_window):
    log = LogScanner()
    tree_bins = int(shell_proxy.eval(TREE_BINS))
    try:
        _set_forge_enabled(shell_proxy, False)
        opened = launch_window()
        _close_window_titled(shell_proxy, opened["title"])

        shell_proxy.activate_workspace(1)
        shell_proxy.activate_workspace(0)
        wait_for(
            shell_proxy.get_active_workspace_index,
            predicate=lambda i: i == 0,
            message="could not return to workspace 0",
        )

        _minimize_and_restore(shell_proxy)

        _rewrite_gap(shell_proxy)

        input_sim.key("shift+super+slash")

        _show_overview(shell_proxy)

        errors = log.new_errors()
        assert errors == [], f"Forge logged errors while disabled: {errors}"
        assert int(shell_proxy.eval(TREE_BINS)) == 0, "a Forge tree came back while disabled"
    except BaseException as failure:
        try:
            _set_forge_enabled(shell_proxy, True)
        except Exception:
            # Report the original failure; the re-enable error stays in its context.
            raise failure
        raise
    _set_forge_enabled(shell_proxy, True)

    wait_for(
        shell_proxy.get_window_count,
        predicate=lambda n: n == 3,
        message="Forge did not re-track the 3 windows",
    )
    # The settings handler bails while the extension has no settings, so a stale
    # one only acts once Forge is enabled again.
    _rewrite_gap(shell_proxy)
    launch_window()
    wait_for(
        shell_proxy.get_window_count,
        predicate=lambda n: n == 4,
        message="Forge did not track a window opened after re-enable",
    )
    wait_for_layout_settled(shell_proxy, window_helper.get_workspace_rect())

    counts = shell_proxy.eval(BORDER_COUNTS)
    assert counts == {"windows": 4, "borders": 4, "owned": 4}, counts
    assert int(shell_proxy.eval(TREE_BINS)) == tree_bins, "a stale WindowManager rebuilt a tree"
    orphans = shell_proxy.fuzz_orphan_actors()
    assert orphans.get("violations") == [], orphans
    errors = log.new_errors()
    assert errors == [], f"Forge logged errors re-enabling: {errors}"
