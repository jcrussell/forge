#!/usr/bin/env python3
"""Removing a workspace must not mix up the windows of the workspaces after it (forge-ext/forge#470).

With dynamic workspaces, closing the last window of a workspace removes that workspace, and GNOME
renumbers the ones after it. Forge's tree names its workspace nodes by index (ws0, ws1, ...) and
dropped the removed one without renaming the others, so a window was then filed under the node of
another workspace, and the windows of two workspaces shared a split (each at half width).

  19.1  one window on each of workspaces 1, 2 and 3; close the one on workspace 1: the other two
        (now on workspaces 1 and 2) each fill their workspace
  19.2  the same with two windows on the middle workspace: they share it, the other fills its own
  19.3  after that, a new window on the (new) first workspace shares it with the window there only

Run on a fresh sandbox:  sandbox/launch.sh && scenarios/19_workspace_removed.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import harness as h  # noqa: E402


def js_win(wid, code):
    return h.js(f"""(() => {{ const w = global.display.list_all_windows().find(w => w.get_id() === {wid});
        {code} }})()""")


def new_editor():
    known = set(all_ids())
    h.open_editor()
    return next(i for i in all_ids() if i not in known)


def all_ids():
    return json.loads(h.js("""JSON.stringify(global.display.list_all_windows()
        .filter(w => w.get_window_type() === 0).map(w => w.get_id()))"""))


def to_workspace(wid, index):
    js_win(wid, f"w.change_workspace_by_index({index}, false); return 'ok';")
    time.sleep(0.8)


def activate_workspace(index):
    h.js(f"""(() => {{ global.workspace_manager.get_workspace_by_index({index})
        .activate(global.get_current_time()); return "ok"; }})()""")
    time.sleep(0.8)
    h.settle()


def state():
    """{window id: (workspace index, frame, workspace node of its tree node)} and the ws count."""
    return json.loads(h.js(f"""JSON.stringify((() => {{
        const out = {{}};
        for (const n of {h.WM}.tree.getNodeByType("WINDOW")) {{
            const w = n.nodeValue, f = w.get_frame_rect();
            let p = n.parentNode; while (p && p.nodeType !== "WORKSPACE") p = p.parentNode;
            out[w.get_id()] = [w.get_workspace()?.index() ?? -1, [f.x, f.y, f.width, f.height], p?.nodeValue ?? null];
        }}
        return {{wins: out, n: global.workspace_manager.get_n_workspaces()}};
    }})())"""))


def area():
    return json.loads(h.js("""JSON.stringify((() => { const a = global.workspace_manager.get_active_workspace()
        .get_work_area_for_monitor(0); return [a.x, a.y, a.width, a.height]; })())"""))


def fills(frame, work, gap_tol=40):
    """A lone tiled window fills the work area (up to its gaps)."""
    x, y, w, hh = frame
    return abs(w - work[2]) <= gap_tol and abs(hh - work[3]) <= gap_tol


def check(name, expect):
    """expect: {window id: (workspace index, how many share it)}; each window must sit on that
    workspace, under the tree node of that workspace, and take 1/n of its width."""
    time.sleep(1.0)
    ok, notes = True, []
    for idx in sorted({ws for ws, _ in expect.values()}):
        activate_workspace(idx)
        st = state()["wins"]
        work = area()
        for wid, (ws, share) in expect.items():
            if ws != idx:
                continue
            got = st.get(str(wid))
            if not got:
                ok = False
                notes.append(f"{wid % 1000} not in the tree")
                continue
            gws, frame, node = got
            width_ok = abs(frame[2] - work[2] / share) <= 40 and abs(frame[3] - work[3]) <= 40
            node_ok = node == f"ws{idx}"
            if gws != idx or not width_ok or not node_ok:
                ok = False
            notes.append(f"{wid % 1000}: workspace {gws + 1} (expected {idx + 1}), tree node {node} "
                         f"(expected ws{idx}), {frame[2]}x{frame[3]} (expected ~{round(work[2] / share)} wide)")
    print(f"  {'PASS' if ok else 'FAIL'}  {name}: " + "; ".join(notes))
    return ok


def main():
    if h.windows():
        raise SystemExit("sandbox must be fresh (no windows); run sandbox/launch.sh first")
    if h.js("global.workspace_manager.get_n_workspaces()") < 1:
        raise SystemExit("no workspaces")
    dynamic = h.js("imports.gi.Meta.prefs_get_dynamic_workspaces()")
    if not dynamic and not h.REAL_SESSION:
        # the sandbox's own settings: turn dynamic workspaces on (GNOME's default)
        h.js('(() => { new imports.gi.Gio.Settings({schema_id: "org.gnome.mutter"})'
             '.set_boolean("dynamic-workspaces", true); return "ok"; })()')
        time.sleep(1.0)
        dynamic = h.js("imports.gi.Meta.prefs_get_dynamic_workspaces()")
    if not dynamic:
        print("  SKIP  dynamic workspaces are off: workspaces aren't removed")
        sys.exit(h.SKIP)
    h.set_forge_setting("auto-split-enabled", False)
    r = []

    # 19.1: A on 1, B on 2, C on 3; close A
    a = new_editor()
    b = new_editor()
    to_workspace(b, 1)
    c = new_editor()
    to_workspace(c, 2)
    n0 = state()["n"]
    activate_workspace(1)             # GNOME removes an empty workspace only when it isn't the active one
    js_win(a, "w.delete(global.get_current_time()); return 'ok';")
    time.sleep(1.5)
    print(f"          workspaces: {n0} before, {state()['n']} after closing the window of workspace 1")
    r.append(check("19.1 close the only window of workspace 1", {b: (0, 1), c: (1, 1)}))

    # 19.2: add D next to C on (now) workspace 2 and E alone on workspace 3; close B
    activate_workspace(1)
    d = new_editor()
    e = new_editor()
    to_workspace(e, 2)
    n0 = state()["n"]
    activate_workspace(1)
    js_win(b, "w.delete(global.get_current_time()); return 'ok';")
    time.sleep(1.5)
    print(f"          workspaces: {n0} before, {state()['n']} after closing the window of workspace 1")
    r.append(check("19.2 two windows on the middle workspace", {c: (0, 2), d: (0, 2), e: (1, 1)}))

    # 19.3: a new window on workspace 2 (E's) shares it with E only
    activate_workspace(1)
    f = new_editor()
    r.append(check("19.3 a new window after the removal", {c: (0, 2), d: (0, 2), e: (1, 2), f: (1, 2)}))
    h.close_windows()
    sys.exit(h.summary(r))


main()
