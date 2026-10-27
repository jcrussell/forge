#!/usr/bin/env python3
"""After Super+V (split vertically) or Super+Z (horizontally), the next window opens that way, also
with auto-split on (forge-ext/forge#409).

Super+V puts the focused window alone in a container that splits vertically, so the next window
should open below it. With auto-split on (the default), opening that window split the focused
window again by its shape (side by side on a landscape screen), overriding the direction the user
just chose.

  25.1  A | B, Super+V on B, open C: C opens below B
  25.2  one window A, Super+V, open B: B opens below A
  25.3  A | B, Super+Z on B (already side by side), open C: C opens beside B (a guard)
  25.4  without any split command, auto-split still decides by shape: A | B, open C with B focused:
        C opens beside or below B according to B's shape (the rule is unchanged)
  25.5  one window, Super+V, then a popup menu opens and closes (F10), then open another: it still
        opens below (a menu is no window of its own for the layout)
  25.6  the same with a dialog (Ctrl+O, the file chooser) instead of the menu: dialogs float, so
        it doesn't count either (skipped if no dialog appears)

Run on a fresh sandbox:  sandbox/launch.sh && scenarios/25_split_then_open.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import harness as h  # noqa: E402


def new_editor():
    known = {w["id"] for w in h.windows()}
    h.open_editor()
    return next(w for w in h.windows() if w["id"] not in known)


def command(wid, cmd):
    h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {wid})
        .activate(global.get_current_time()); {h.WM}.command({cmd}); return "ok"; }})()""")
    time.sleep(1.0)
    h.settle()


def activate(wid):
    h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {wid})
        .activate(global.get_current_time()); return "ok"; }})()""")
    time.sleep(0.8)


def relation(a_id, b_id):
    """'below' if b is under a (same column), 'beside' if to its right (same row), else '?'."""
    ws = h.windows()
    a, b = h.find(ws, a_id), h.find(ws, b_id)
    if abs(a["x"] - b["x"]) <= h.TOL and b["y"] >= a["y"] + a["h"] - h.TOL:
        return "below"
    if abs(a["y"] - b["y"]) <= h.TOL and b["x"] >= a["x"] + a["w"] - h.TOL:
        return "beside"
    return "?"


def check(name, a_id, b_id, want):
    got = relation(a_id, b_id)
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {name}: new window {got} (expected {want}); layout {h.tree_summary()}")
    return ok


def main():
    if h.windows():
        raise SystemExit("sandbox must be fresh (no windows); run sandbox/launch.sh first")
    h.set_forge_setting("auto-split-enabled", True)
    r = []

    a, b = new_editor(), new_editor()
    command(b["id"], '{name: "Split", orientation: "vertical"}')
    c = new_editor()
    r.append(check("25.1 A | B, Super+V on B, open C", b["id"], c["id"], "below"))
    h.close_windows()
    time.sleep(1.0)

    a = new_editor()
    command(a["id"], '{name: "Split", orientation: "vertical"}')
    b = new_editor()
    r.append(check("25.2 one window, Super+V, open another", a["id"], b["id"], "below"))
    h.close_windows()
    time.sleep(1.0)

    a, b = new_editor(), new_editor()
    command(b["id"], '{name: "Split", orientation: "horizontal"}')
    c = new_editor()
    r.append(check("25.3 A | B, Super+Z on B, open C", b["id"], c["id"], "beside"))
    h.close_windows()
    time.sleep(1.0)

    a, b = new_editor(), new_editor()
    activate(b["id"])
    fb = h.find(h.windows(), b["id"])
    want = "beside" if fb["w"] > fb["h"] else "below"
    c = new_editor()
    r.append(check(f"25.4 no split command: auto-split by B's shape ({fb['w']}x{fb['h']})", b["id"], c["id"], want))
    h.close_windows()
    time.sleep(1.0)

    a = new_editor()
    command(a["id"], '{name: "Split", orientation: "vertical"}')
    h.hold_keys(a["id"], "0xffc7", 0)          # F10: the app's main menu, a popup window
    time.sleep(1.0)
    popups = h.js("global.display.list_all_windows().filter(w => w.get_window_type() !== 0).length")
    h.hold_keys(a["id"], "0xff1b", 0)          # Escape: close it
    time.sleep(0.8)
    b = new_editor()
    print(f"          (windows other than normal ones while the menu was open: {popups})")
    r.append(check("25.5 Super+V, a menu opens and closes, open another", a["id"], b["id"], "below"))
    h.close_windows()
    time.sleep(1.0)

    a = new_editor()
    command(a["id"], '{name: "Split", orientation: "vertical"}')
    h.hold_keys(a["id"], "0xffe3, 0x6f", 0)    # Ctrl+O: the file chooser dialog
    time.sleep(2.0)
    dialogs = h.js("global.display.list_all_windows().filter(w => w.get_window_type() === 3 "
                   "|| w.get_window_type() === 4 || w.get_transient_for() !== null).length")
    if dialogs:
        h.js("""(() => { global.display.list_all_windows().filter(w => w.get_window_type() === 3
            || w.get_window_type() === 4 || w.get_transient_for() !== null)
            .forEach(w => w.delete(global.get_current_time())); return "ok"; })()""")
        time.sleep(1.0)
        b = new_editor()
        r.append(check("25.6 Super+V, a dialog opens and closes, open another", a["id"], b["id"], "below"))
    else:
        print("  SKIP  25.6: no dialog appeared for Ctrl+O here")
    h.close_windows()
    sys.exit(h.summary(r))


main()
