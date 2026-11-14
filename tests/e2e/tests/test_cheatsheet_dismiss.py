"""Regression for the keybindings cheatsheet dismissal (forge-0rb6 / forge-k5m6).

show() connected to "monitors-changed" on global.display, but that signal is
emitted by Main.layoutManager, not MetaDisplay. The connect threw *after* the
reactive backdrop + panel were parented and grab_key_focus() ran, but *before*
_visible was set — stranding a full-screen reactive overlay that swallowed all
input while every dismiss path (gated on _visible) no-oped. This drives the real
overlay via Shell.Eval and asserts that show() never throws and that no
cheatsheet actor is left parented (a stranded reactive backdrop) after dismissal.
"""

import json
import os
import time

import pytest
from framework.wait import wait_for

# Resolve the live Cheatsheet and snapshot the state that distinguishes a clean
# overlay from a stranded, input-grabbing one.
PRELUDE = r"""
const ext = Main.extensionManager.lookup('forge@jcrussell.github.io').stateObj;
const sheet = ext && ext.cheatsheet
  ? ext.cheatsheet
  : (ext && ext.keybindings && ext.keybindings.cheatsheet);
function uiKids() { return Main.layoutManager.uiGroup.get_children(); }
function hasClass(a, c) {
  const n = a.get_style_class_name ? a.get_style_class_name() : (a.style_class || '');
  return (n || '').split(/\s+/).indexOf(c) !== -1;
}
function ours(a) { return hasClass(a, 'forge-cheatsheet-backdrop') || hasClass(a, 'forge-cheatsheet'); }
function state(tag) {
  const kids = uiKids();
  return {
    tag: tag,
    visible: sheet ? sheet._visible : 'no-sheet',
    backdrops: kids.filter((a) => hasClass(a, 'forge-cheatsheet-backdrop')).length,
    panels: kids.filter((a) => hasClass(a, 'forge-cheatsheet')).length,
    reactiveOrphans: kids.filter((a) => ours(a) && a.reactive).length,
    overlayHasKeyFocus: sheet && sheet._overlay ? (global.stage.get_key_focus() === sheet._overlay) : false,
  };
}
"""

# Long enough for the 100ms hide ease + its onComplete teardown to settle.
FADE_SETTLE = 0.4

SHELL_LOG = "/tmp/gnome-shell.log"
# St names the overlay in the critical it logs when the actor is touched after
# it left the stage.
LOG_MARKER = "forge-cheatsheet"


def _run(shell_proxy, body):
    return shell_proxy.eval("(() => {\n" + PRELUDE + "\n" + body + "\n})()")


def test_cheatsheet_show_does_not_throw_and_closes_clean(shell_proxy):
    opened = _run(
        shell_proxy,
        r"""
        if (!sheet) return JSON.stringify({err: 'no-sheet'});
        let showErr = null;
        try { sheet.show(); } catch (e) { showErr = '' + e; }
        return JSON.stringify({showErr, state: state('opened')});
        """,
    )
    print("\nopened:", json.dumps(opened, indent=2))
    assert isinstance(opened, dict) and "err" not in opened, opened
    assert opened["showErr"] is None, f"show() threw: {opened['showErr']}"
    assert opened["state"]["visible"] is True, opened["state"]
    assert opened["state"]["panels"] >= 1, opened["state"]

    closed = _run(
        shell_proxy,
        "let e=null; try { sheet.hide(); } catch (x) { e=''+x; } return JSON.stringify({hideErr:e});",
    )
    assert closed.get("hideErr") is None, closed
    time.sleep(FADE_SETTLE)

    after = _run(shell_proxy, "return JSON.stringify(state('closed'));")
    print("closed:", json.dumps(after, indent=2))
    assert after["visible"] is False, after
    assert after["panels"] == 0, f"panel left parented after close: {after}"
    assert after["backdrops"] == 0, f"backdrop left parented after close: {after}"
    assert after["reactiveOrphans"] == 0, f"stranded reactive actor after close: {after}"


def _log_offset():
    try:
        return os.path.getsize(SHELL_LOG)
    except OSError:
        return 0


def _log_lines_since(offset):
    with open(SHELL_LOG, errors="replace") as fh:
        fh.seek(offset)
        return fh.read().splitlines()


INTERFACE = "imports.gi.Gio.Settings.new('org.gnome.desktop.interface')"
ST_SETTINGS = "imports.gi.St.Settings.get()"


def _eval_bool(shell_proxy, js):
    value = shell_proxy.eval(js)
    return value is True or value == "true"


@pytest.fixture
def animations(shell_proxy):
    """Turn animations on (the e2e session turns them off), so hide() eases out
    and the next show() lands mid-fade, as it does for a user. Teardown undoes
    exactly what setup changed, even when setup fails part way."""
    prior = _eval_bool(shell_proxy, f"{INTERFACE}.get_boolean('enable-animations')")
    uninhibited = False
    try:
        shell_proxy.eval(f"{INTERFACE}.set_boolean('enable-animations', true)")
        # GNOME Shell inhibits animations on software rendering, which the
        # container uses.
        if not _eval_bool(shell_proxy, f"{ST_SETTINGS}.enable_animations"):
            shell_proxy.eval(f"{ST_SETTINGS}.uninhibit_animations()")
            uninhibited = True
        wait_for(
            lambda: _eval_bool(shell_proxy, f"{ST_SETTINGS}.enable_animations"),
            message="St enable_animations never became true",
        )
        yield
    finally:
        if uninhibited:
            shell_proxy.eval(f"{ST_SETTINGS}.inhibit_animations()")
        shell_proxy.eval(
            f"{INTERFACE}.set_boolean('enable-animations', {'true' if prior else 'false'})"
        )


def test_cheatsheet_rapid_toggle_never_strands_input(shell_proxy, animations):
    """Interleave show/hide without waiting for the fade. show() must never throw,
    no reactive orphan may survive, nothing may touch an overlay after it left the
    stage, and a fresh open must still work."""
    log_offset = _log_offset()
    rapid = _run(
        shell_proxy,
        r"""
        if (!sheet) return JSON.stringify({err: 'no-sheet'});
        const errors = [];
        for (let i = 0; i < 4; i++) {
          try { sheet.show(); } catch (e) { errors.push('show' + i + ':' + e); }
          try { sheet.hide(); } catch (e) { errors.push('hide' + i + ':' + e); }
        }
        return JSON.stringify({errors, immediate: state('rapid')});
        """,
    )
    print("\nrapid:", json.dumps(rapid, indent=2))
    assert isinstance(rapid, dict) and "err" not in rapid, rapid
    assert rapid["errors"] == [], f"show/hide threw during rapid toggle: {rapid['errors']}"

    time.sleep(FADE_SETTLE)
    settled = _run(shell_proxy, "return JSON.stringify(state('settled'));")
    print("settled:", json.dumps(settled, indent=2))
    assert settled["reactiveOrphans"] == 0, f"stranded reactive actor after rapid toggle: {settled}"
    logged = [line for line in _log_lines_since(log_offset) if LOG_MARKER in line]
    assert logged == [], f"overlay touched off-stage during rapid toggle: {logged}"

    # Re-open must still produce a working, visible panel (not a dead reused actor).
    reopened = _run(
        shell_proxy,
        "let e=null; try { sheet.show(); } catch (x) { e=''+x; } return JSON.stringify({showErr:e, state:state('reopened')});",
    )
    print("reopened:", json.dumps(reopened, indent=2))
    assert reopened["showErr"] is None, reopened
    assert reopened["state"]["visible"] is True, reopened["state"]
    assert reopened["state"]["panels"] >= 1, reopened["state"]

    _run(shell_proxy, "try { sheet.hide(); } catch (e) {} return JSON.stringify({});")
    time.sleep(FADE_SETTLE)
    final = _run(shell_proxy, "return JSON.stringify(state('final'));")
    print("final:", json.dumps(final, indent=2))
    assert final["visible"] is False, final
    assert final["panels"] == 0 and final["backdrops"] == 0, final
    assert final["reactiveOrphans"] == 0, final
    assert final["overlayHasKeyFocus"] is False, final
