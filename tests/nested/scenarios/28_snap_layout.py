#!/usr/bin/env python3
"""Snapping a window (Ctrl+Alt+T etc.) floats that window only (forge-ext/forge#469, also #426).

The snap-layout keys (e.g. Ctrl+Alt+T: two thirds on the right) float the focused window and put
it in that part of the screen. Forge floated it by saving a float rule for the whole app, without
applying it right away: the window was tiled again at once (the key seemed to do nothing), the
rule stayed in windows.json (after a restart every window of that app floated), and Super+C, which
only removes rules for one window, couldn't undo it.

  28.1  two Text Editor windows; snap one to the right two thirds: it floats there
  28.2  no rule for the whole app was saved (windows.json)
  28.3  Super+C on the snapped window tiles it again
  28.4  after Forge restarts (it reads windows.json again), a new Text Editor window opens tiled
  28.5  snap both Text Editor windows (one left, one right): both float in their places

Run on a fresh sandbox:  sandbox/launch.sh && scenarios/28_snap_layout.py
"""
import json
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
    time.sleep(1.5)
    h.settle()


def app_rules():
    """Float rules for the whole Text Editor app (no window id) in the sandbox's windows.json."""
    path = h.js('GLib.build_filenamev([GLib.get_user_config_dir(), "forge", "config", "windows.json"])')
    if not os.path.exists(path):
        return []
    try:
        overrides = json.load(open(path)).get("overrides", [])
    except ValueError:
        return ["(unreadable)"]
    return [o for o in overrides if "TextEditor" in str(o.get("wmClass")) and o.get("mode") == "float"
            and not o.get("wmId") and not o.get("wmTitle")]


def restart_forge():
    """Disable and enable Forge in the sandbox shell (asynchronous in GNOME 50)."""
    uuid = "forge@jmmaranan.com"
    for call, want in (("disableExtension", (2, 3)), ("enableExtension", (1, 3))):
        h.js(f'(() => {{ Main.extensionManager.{call}("{uuid}"); return "ok"; }})()')
        for _ in range(60):
            if h.js(f'Main.extensionManager.lookup("{uuid}").state') in want:
                break
            time.sleep(0.25)
    time.sleep(1.0)
    h.settle()


def main():
    if h.windows():
        raise SystemExit("sandbox must be fresh (no windows); run sandbox/launch.sh first")
    if h.REAL_SESSION:
        print("  SKIP  28: reads windows.json, which in a real session is yours")
        sys.exit(h.SKIP)
    h.set_forge_setting("auto-split-enabled", False)
    a, b = new_editor(), new_editor()
    r = []

    command(b["id"], '{name: "SnapLayoutMove", direction: "Right", amount: 2 / 3}')
    time.sleep(1.0)                                    # (and a render after it)
    h.js(f'(() => {{ {h.WM}.renderTree("test", true); return "ok"; }})()')
    time.sleep(1.0)
    h.settle()
    wb = h.find(h.windows(), b["id"])
    area = json.loads(h.js("""JSON.stringify((() => { const a = global.workspace_manager.get_active_workspace()
        .get_work_area_for_monitor(0); return [a.x, a.y, a.width, a.height]; })())"""))
    want_x = area[0] + area[2] / 3
    placed = abs(wb["x"] - want_x) <= 30 and abs(wb["x"] + wb["w"] - (area[0] + area[2])) <= 30
    ok = wb["float"] and placed
    print(f"  {'PASS' if ok else 'FAIL'}  28.1 snap to the right two thirds: floating {wb['float']}, "
          f"at x={wb['x']} w={wb['w']} (expected about x={round(want_x)}, reaching the right edge)")
    r.append(ok)

    rules = app_rules()
    ok = not rules
    print(f"  {'PASS' if ok else 'FAIL'}  28.2 no float rule for the whole app saved: {rules or 'none'}")
    r.append(ok)

    h.hold_keys(b["id"], h.chord("window-toggle-float"), 0)
    time.sleep(1.2)
    h.settle()
    ok = not h.find(h.windows(), b["id"])["float"]
    print(f"  {'PASS' if ok else 'FAIL'}  28.3 Super+C on the snapped window tiles it again: {ok}")
    r.append(ok)

    restart_forge()                                    # (as after a log-in: windows.json read again)
    c = new_editor()
    ok = not h.find(h.windows(), c["id"])["float"]
    print(f"  {'PASS' if ok else 'FAIL'}  28.4 after Forge restarts, a new Text Editor window opens tiled: {ok}")
    r.append(ok)
    h.close_windows()
    time.sleep(1.0)

    a, b = new_editor(), new_editor()
    command(a["id"], '{name: "SnapLayoutMove", direction: "Left", amount: 1 / 3}')
    command(b["id"], '{name: "SnapLayoutMove", direction: "Right", amount: 2 / 3}')
    h.js(f'(() => {{ {h.WM}.renderTree("test", true); return "ok"; }})()')
    time.sleep(1.0)
    h.settle()
    ws = h.windows()
    fa, fb = h.find(ws, a["id"]), h.find(ws, b["id"])
    ok = fa["float"] and fb["float"]
    print(f"  {'PASS' if ok else 'FAIL'}  28.5 snap both windows of the app: floating {fa['float']} (left third), "
          f"{fb['float']} (right two thirds)")
    r.append(ok)
    h.close_windows()
    sys.exit(h.summary(r))


main()
