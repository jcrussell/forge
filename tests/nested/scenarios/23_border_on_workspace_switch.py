#!/usr/bin/env python3
"""The focus border doesn't stay on screen after switching workspaces (forge-ext/forge#268).

Forge draws the focused window's border as a separate actor. With tiling turned off, switching to
another workspace left the border of the window from the previous workspace on screen.

  23.1  tiling off, focus border on, a window on workspace 1; switch to (empty) workspace 2: no
        border shows
  23.2  back on workspace 1: the window's border shows again
  23.3  the same with tiling on (it worked there; a guard)

Run on a fresh sandbox:  sandbox/launch.sh && scenarios/23_border_on_workspace_switch.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import harness as h  # noqa: E402


def workspace(index):
    h.js(f"""(() => {{ const wm = global.workspace_manager;
        while (wm.get_n_workspaces() <= {index}) wm.append_new_workspace(false, global.get_current_time());
        wm.get_workspace_by_index({index}).activate(global.get_current_time()); return "ok"; }})()""")
    time.sleep(1.2)


def visible_borders():
    """The windows whose Forge border (focus or split) is showing: [[title, x, y, w, h], ...]. The
    desktop icons window (type DESKTOP, e.g. Ubuntu's) is left out: on an empty workspace it gets
    the focus, and Forge gives it a 6x6 border at 0,0 (under the top bar; not this bug)."""
    return json.loads(h.js("""JSON.stringify(global.display.list_all_windows()
        .filter(w => w.get_window_type() !== imports.gi.Meta.WindowType.DESKTOP)
        .map(w => [w, w.get_compositor_private()])
        .filter(([w, a]) => a && ((a.border && a.border.visible) || (a.splitBorder && a.splitBorder.visible)))
        .map(([w, a]) => { const b = a.border?.visible ? a.border : a.splitBorder;
            return [w.get_title(), Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }))"""))


def run(prefix, tiling):
    h.set_forge_setting("tiling-mode-enabled", tiling)
    time.sleep(0.8)
    workspace(0)
    known = {w["id"] for w in h.windows()}
    h.open_editor()
    wid = next(w["id"] for w in h.windows() if w["id"] not in known)
    h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {wid})
        .activate(global.get_current_time()); return "ok"; }})()""")
    time.sleep(1.0)
    on_first = visible_borders()
    workspace(1)
    away = visible_borders()
    ok1 = not away
    mode = "on" if tiling else "off"
    print(f"  {'PASS' if ok1 else 'FAIL'}  {prefix}.1 tiling {mode}: on workspace 2 (empty) the borders showing: "
          f"{away or 'none'} (expected none; on workspace 1 there were {len(on_first)})")
    workspace(0)
    h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {wid})
        .activate(global.get_current_time()); return "ok"; }})()""")
    time.sleep(1.0)
    back = visible_borders()
    ok2 = len(back) >= 1 or len(on_first) == 0
    print(f"  {'PASS' if ok2 else 'FAIL'}  {prefix}.2 tiling {mode}: back on workspace 1 the window's border "
          f"shows: {back or 'none'}")
    h.close_windows()
    time.sleep(0.8)
    return [ok1, ok2]


def main():
    if h.windows():
        raise SystemExit("sandbox must be fresh (no windows); run sandbox/launch.sh first")
    h.set_forge_setting("focus-border-toggle", True)
    r = run("23", False)
    r += run("23.3", True)
    h.set_forge_setting("tiling-mode-enabled", True)
    sys.exit(h.summary(r))


main()
