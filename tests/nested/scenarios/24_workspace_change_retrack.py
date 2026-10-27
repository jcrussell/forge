#!/usr/bin/env python3
"""Adding or removing a workspace leaves the layout alone (forge-ext/forge#540).

When a workspace is added or removed, GNOME recomputes the work areas and Forge re-tracks every
window (trackCurrentWindows). trackWindow() ran the auto-split for the focused window each time,
also for windows it already tracked: the focused window was wrapped in another container per
window re-tracked. If the focused window had never been laid out (e.g. it floats), the new
container got its empty rect and Forge threw "TypeError: rect is null" in the signal handler.

  24.1  three tiled windows (auto-split on), one focused; add a workspace: the layout is unchanged
  24.2  remove it again: the layout is unchanged
  24.3  a window that floated from the start focused; add a workspace: no Forge error, the layout
        unchanged

Run on a fresh sandbox:  sandbox/launch.sh && scenarios/24_workspace_change_retrack.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import harness as h  # noqa: E402


def new_editor():
    known = {w["id"] for w in h.windows()}
    h.open_editor()
    return next(w["id"] for w in h.windows() if w["id"] not in known)


def activate(wid):
    h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {wid})
        .activate(global.get_current_time()); return "ok"; }})()""")
    time.sleep(0.8)


def add_workspace():
    h.js("""(() => { global.workspace_manager.append_new_workspace(false, global.get_current_time());
        return "ok"; })()""")
    time.sleep(1.5)
    h.settle()


def remove_last_workspace():
    h.js("""(() => { const wm = global.workspace_manager;
        wm.remove_workspace(wm.get_workspace_by_index(wm.get_n_workspaces() - 1), global.get_current_time());
        return "ok"; })()""")
    time.sleep(1.5)
    h.settle()


def main():
    if h.windows():
        raise SystemExit("sandbox must be fresh (no windows); run sandbox/launch.sh first")
    h.set_forge_setting("auto-split-enabled", True)
    h.js("""(() => { new imports.gi.Gio.Settings({schema_id: "org.gnome.mutter"})
        .set_boolean("dynamic-workspaces", false); return "ok"; })()""")
    time.sleep(0.5)
    ids = [new_editor() for _ in range(3)]
    activate(ids[1])
    h.settle()
    r = []

    before = h.tree_summary()
    errors0 = h.js_errors()
    add_workspace()
    after = h.tree_summary()
    ok = after == before
    print(f"  {'PASS' if ok else 'FAIL'}  24.1 add a workspace: layout {after} (before {before})")
    r.append(ok)

    remove_last_workspace()
    after2 = h.tree_summary()
    ok = after2 == before
    print(f"  {'PASS' if ok else 'FAIL'}  24.2 remove it again: layout {after2} (before {before})")
    r.append(ok)

    # 24.3: a window that floats from the start (so Forge never laid it out) has the focus: Text
    # Editor set to "always float", then a new one opened
    h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {ids[0]})
        .activate(global.get_current_time()); {h.WM}.command({{name: "FloatClassToggle"}}); return "ok"; }})()""")
    time.sleep(1.0)
    f = new_editor()
    activate(f)
    h.settle()
    before3 = h.tree_summary()
    errors1 = h.js_errors()
    add_workspace()
    errors2 = h.js_errors()
    after3 = h.tree_summary()
    ok = errors2 == errors1 and after3 == before3
    print(f"  {'PASS' if ok else 'FAIL'}  24.3 floating window focused, add a workspace: new Forge errors "
          f"{errors2 - errors1} (expected 0), layout {after3} (before {before3})")
    r.append(ok)
    print(f"          (Forge errors before the scenario's workspace changes: {errors0})")
    h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {f})
        .activate(global.get_current_time()); {h.WM}.command({{name: "FloatClassToggle"}}); return "ok"; }})()""")
    time.sleep(0.5)
    h.close_windows()
    sys.exit(h.summary(r))


main()
