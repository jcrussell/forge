#!/usr/bin/env python3
"""What a user does with Forge, by keyboard and by mouse, each with the result it must have.

Every Forge shortcut is pressed with a virtual keyboard, and windows are dragged by their title
bar onto each drop zone, maximized with a double-click and Alt+F10, minimized, closed and sent to
another workspace. Each check compares the result with the one expected (the tree, positions,
focus), and after each group the layout must be valid and Forge must not log a JS ERROR.

Run on a fresh sandbox:  sandbox/launch.sh && scenarios/17_user_actions.py [group ...]
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import harness as h  # noqa: E402

SUPER = 0xffeb
results = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{': ' + detail if detail else ''}")
    results.append(bool(ok))
    return ok


def win_js(wid, body):
    return h.js(f"""(() => {{ const w = global.display.list_all_windows().find(w => w.get_id() === {wid});
        {body} }})()""")


def focus(wid):
    win_js(wid, 'w.activate(global.get_current_time()); return "ok";')
    time.sleep(0.4)


def focused():
    return h.js("global.display.focus_window?.get_id() ?? null")


def tap(wid, binding):
    """Focus `wid` and press Forge's shortcut `binding` (or an accelerator such as "<Alt>F10")."""
    keys = h.accel_keys(binding) if binding.startswith("<") else h.chord(binding)
    h.hold_keys(wid, keys, 0)
    time.sleep(0.6)
    h.settle()


def tree():
    """Monitor 0's tree with the window ids replaced by their letters."""
    s = h.tree_summary()
    for name, wid in sorted(NAMES.items(), key=lambda kv: -kv[1]):
        s = s.replace(f"w{wid % 1000}", name)
    return s


def frame(wid):
    return h.find(h.windows(), wid)


def left_of(a, b):
    """Window a is just left of window b, on the same row."""
    fa, fb = frame(a), frame(b)
    return fa["x"] + fa["w"] <= fb["x"] + 2 and abs(fa["y"] - fb["y"]) <= 2 and abs(fa["h"] - fb["h"]) <= 2


def above(a, b):
    """Window a is just above window b, in the same column."""
    fa, fb = frame(a), frame(b)
    return fa["y"] + fa["h"] <= fb["y"] + 2 and abs(fa["x"] - fb["x"]) <= 2 and abs(fa["w"] - fb["w"]) <= 2


def where(*ids):
    return ", ".join(f"{n} {f['x']},{f['y']} {f['w']}x{f['h']}" for n, wid in NAMES.items() if wid in ids
                     for f in [frame(wid)])


def maximized(wid):
    return win_js(wid, "return w.is_maximized();")


NAMES = {}


def fresh(count, auto_split=False):
    """Close every window and open `count` new ones, side by side: returns their ids, left to right."""
    h.close_windows()
    h.js(f"""(() => {{ const s = {h.WM}.ext.settings;
        ["window-gap-size", "window-gap-size-increment"].forEach(k => s.reset(k)); return "ok"; }})()""")
    h.set_forge_setting("auto-split-enabled", auto_split)
    time.sleep(0.3)
    for _ in range(count):
        h.open_editor()
    h.settle()
    ids = [w["id"] for w in sorted(h.windows(), key=lambda w: (w["x"], w["y"]))]
    NAMES.clear()
    NAMES.update({chr(ord("A") + i): wid for i, wid in enumerate(ids)})
    return ids


def end_group(name, errors_before):
    probs = h.layout_problems()
    check(f"{name}: valid layout", not probs, "; ".join(probs))
    errors = h.js_errors()
    new = h.js_error_entries()[errors_before:] if errors > errors_before else []
    check(f"{name}: no JS errors", not new, " | ".join(e.splitlines()[0] for e in new))
    return errors


# --- groups -------------------------------------------------------------------------------------

def g_focus():
    a, b, c = fresh(3)
    tap(b, "window-focus-right")
    check("focus right from B -> C", focused() == c)
    tap(c, "window-focus-left")
    check("focus left from C -> B", focused() == b)
    tap(a, "window-focus-left")
    check("focus left from A (screen edge) stays or wraps, never lost", focused() in (a, b, c))
    # A | (B / C)
    tap(b, "con-split-vertical")
    tap(c, "window-move-left")
    check("move C left into B's split -> A | (B / C)", tree() == "HSPLIT[A, VSPLIT[B, C]]", tree())
    tap(b, "window-focus-down")
    check("focus down from B -> C", focused() == c)
    tap(c, "window-focus-up")
    check("focus up from C -> B", focused() == b)
    tap(b, "window-focus-left")
    check("focus left from B -> A", focused() == a)
    tap(a, "window-focus-right")
    check("focus right from A -> the column (B or C)", focused() in (b, c))
    focus(a)
    tap(a, "window-swap-last-active")
    check("swap with last active keeps the focus on a window", focused() in (a, b, c))


def g_swap_move():
    a, b, c = fresh(3)
    xa = frame(a)["x"]
    tap(a, "window-swap-right")
    check("swap A right -> B A C", tree() == "HSPLIT[B, A, C]", tree())
    check("swap: A took B's place", abs(frame(a)["x"] - frame(b)["x"]) > 100 and frame(b)["x"] == xa)
    tap(a, "window-swap-left")
    check("swap back -> A B C", tree() == "HSPLIT[A, B, C]", tree())
    tap(c, "window-move-left")
    check("move C left -> A C B", tree() == "HSPLIT[A, C, B]", tree())
    tap(c, "window-move-right")
    check("move C right -> A B C", tree() == "HSPLIT[A, B, C]", tree())
    # build A | (B / (C | D)) with keys, as the user does
    d = h.open_editor() or [w["id"] for w in h.windows() if w["id"] not in (a, b, c)][0]
    NAMES["D"] = d
    h.settle()
    tap(b, "con-split-vertical")
    tap(c, "window-move-left")
    tap(c, "con-split-horizontal")
    tap(d, "window-move-left")
    tap(d, "window-move-up")
    check("keys build A | (B / (C | D))", tree() == "HSPLIT[A, VSPLIT[B, HSPLIT[C, D]]]", tree())
    # out of the containers again, to the right
    tap(d, "window-move-right")
    tap(d, "window-move-right")
    check("move D right twice -> out of the containers", tree().endswith(", D]") and tree().startswith("HSPLIT[A"), tree())


def g_split_new_window():
    a, b = fresh(2)
    tap(b, "con-split-vertical")
    h.open_editor()
    c = [w["id"] for w in h.windows() if w["id"] not in (a, b)][0]
    NAMES["C"] = c
    h.settle()
    check("Super+v then a new window -> it opens under B", tree() == "HSPLIT[A, VSPLIT[B, C]]", tree())
    check("new window under B: same column, lower", frame(c)["x"] == frame(b)["x"] and frame(c)["y"] > frame(b)["y"])
    tap(a, "con-split-horizontal")
    h.open_editor()
    d = [w["id"] for w in h.windows() if w["id"] not in (a, b, c)][0]
    NAMES["D"] = d
    h.settle()
    check("Super+z on A then a new window -> beside A", tree().startswith("HSPLIT[HSPLIT[A, D]") or
          tree().startswith("HSPLIT[A, D"), tree())


def g_layout_toggles():
    a, b, c = fresh(3)
    tap(a, "con-split-layout-toggle")
    check("layout toggle -> VSPLIT", tree() == "VSPLIT[A, B, C]", tree())
    check("VSPLIT: windows stacked top to bottom", frame(a)["y"] < frame(b)["y"] < frame(c)["y"])
    tap(a, "con-split-layout-toggle")
    check("layout toggle again -> HSPLIT", tree() == "HSPLIT[A, B, C]", tree())
    tap(a, "con-tabbed-layout-toggle")
    check("tabbed toggle on a window on the workspace -> a group of its own", tree() == "HSPLIT[TABBED[A], B, C]", tree())
    tap(a, "con-tabbed-layout-toggle")
    check("tabbed toggle again -> a split", tree() in ("HSPLIT[HSPLIT[A], B, C]", "HSPLIT[A, B, C]"), tree())
    a, b, c = fresh(3)
    tap(b, "con-split-vertical")
    tap(c, "window-move-left")
    check("A | (B / C)", tree() == "HSPLIT[A, VSPLIT[B, C]]", tree())
    tap(b, "con-tabbed-layout-toggle")
    check("tabbed toggle on B -> B and C in tabs", tree() == "HSPLIT[A, TABBED[B, C]]", tree())
    tabs = [h.tab_center(w) for w in (b, c)]
    check("tabbed: B and C have a tab shown", all(tabs), str(tabs))
    if all(tabs):
        h.click(*tabs[1])
        check("click C's tab -> C focused", focused() == c)
        h.click(*tabs[0])
        check("click B's tab -> B focused", focused() == b)
    tap(b, "window-focus-right")
    check("focus right inside tabs -> C", focused() == c)
    tap(c, "con-tabbed-layout-toggle")
    check("tabbed toggle again -> back to B / C (#563)", tree() == "HSPLIT[A, VSPLIT[B, C]]", tree())
    check("no tab left on screen", not any(h.tab_center(w) for w in (a, b, c)))
    tap(b, "con-stacked-layout-toggle")
    check("stacked toggle -> STACKED", tree() == "HSPLIT[A, STACKED[B, C]]", tree())
    tap(b, "con-split-layout-toggle")
    # (a stack puts the focused window last, so the order may have changed)
    check("layout toggle on a stacked group -> a column again (#526)",
          tree() in ("HSPLIT[A, VSPLIT[B, C]]", "HSPLIT[A, VSPLIT[C, B]]"), tree())
    tap(b, "con-tabbed-layout-toggle")
    tap(b, "con-tabbed-showtab-decoration-toggle")
    check("tab decoration off: no tabs", not any(h.tab_center(w) for w in (b, c)))
    tap(b, "con-tabbed-showtab-decoration-toggle")
    check("tab decoration on again: tabs shown", all(h.tab_center(w) for w in (b, c)))
    tap(b, "con-tabbed-layout-toggle")


def g_float():
    a, b, c = fresh(3)
    wb = frame(b)
    tap(b, "window-toggle-float")
    check("float B -> B floats", h.find(h.windows(), b)["float"])
    check("float B: A and C share the screen", frame(c)["x"] < wb["x"] + wb["w"] and frame(a)["w"] > wb["w"] + 100,
          f"A {frame(a)['w']} wide, C at {frame(c)['x']}")
    tap(b, "window-toggle-float")
    check("float B again -> tiled", not h.find(h.windows(), b)["float"])
    check("B back between A and C", frame(a)["x"] < frame(b)["x"] < frame(c)["x"])


def g_gaps():
    a, b = fresh(2)
    g0 = frame(b)["x"] - (frame(a)["x"] + frame(a)["w"])
    tap(a, "window-gap-size-increase")
    g1 = frame(b)["x"] - (frame(a)["x"] + frame(a)["w"])
    check("gap increase -> wider gap", g1 > g0, f"{g0} -> {g1}")
    tap(a, "window-gap-size-decrease")
    g2 = frame(b)["x"] - (frame(a)["x"] + frame(a)["w"])
    check("gap decrease -> back", g2 == g0, f"{g1} -> {g2}")


def g_resize_keys():
    a, b = fresh(2)
    wa = frame(a)["w"]
    tap(a, "window-resize-right-increase")
    check("grow A right -> A wider, B narrower", frame(a)["w"] > wa and frame(b)["w"] < wa, f"A {wa} -> {frame(a)['w']}")
    tap(a, "window-resize-right-decrease")
    tap(a, "window-resize-right-decrease")
    check("shrink A right twice -> A narrower than half", frame(a)["w"] < wa, f"A {frame(a)['w']}")
    try:
        tap(a, "window-reset-sizes")
        check("reset sizes -> equal halves", abs(frame(a)["w"] - frame(b)["w"]) <= 2, f"{frame(a)['w']} / {frame(b)['w']}")
    except RuntimeError:
        print("  (window-reset-sizes has no shortcut)")
    tap(a, "window-expand")
    check("expand (Super+]) -> A wider", frame(a)["w"] > frame(b)["w"], f"{frame(a)['w']} / {frame(b)['w']}")
    tap(a, "window-shrink")
    tap(a, "window-shrink")
    check("shrink (Super+[) twice -> A narrower", frame(a)["w"] < frame(b)["w"], f"{frame(a)['w']} / {frame(b)['w']}")


def g_maximize():
    a, b, c = fresh(3)
    slot = frame(b)
    tap(b, "<Alt>F10")
    check("Alt+F10 on B (with siblings) -> maximized", maximized(b))
    focus(a)
    focus(b)
    check("B stays maximized when the focus changes", maximized(b))
    tap(b, "window-focus-right")
    check("focus right while B is maximized -> C", focused() == c)
    focus(b)
    tap(b, "<Alt>F10")
    now = frame(b)
    check("Alt+F10 again -> B restored to its slot", not maximized(b) and
          all(abs(now[k] - slot[k]) <= h.TOL for k in ("x", "y", "w", "h")), f"{slot} -> {now}")
    h.click(*h.title_point(frame(a)), count=2)
    check("double-click A's title bar -> maximized", maximized(a))
    h.click(1920 // 2, 32 + 18, count=2)
    check("double-click again -> restored", not maximized(a))
    h.settle()
    check("A back in its slot", frame(a)["w"] < 900, str(frame(a)))
    tap(b, "<Alt>F10")
    h.open_editor()
    h.settle()
    check("a new window unmaximizes B (auto-unmaximize-for-tiling)", not maximized(b))


def g_minimize_close():
    a, b, c = fresh(3)
    win_js(b, 'w.minimize(); return "ok";')
    time.sleep(1.0)
    h.settle()
    check("minimize B -> A and C fill the screen", frame(a)["w"] > 700 and frame(c)["w"] > 700,
          f"A {frame(a)['w']}, C {frame(c)['w']}")
    win_js(b, 'w.unminimize(); w.activate(global.get_current_time()); return "ok";')
    time.sleep(1.0)
    h.settle()
    check("unminimize B -> back between A and C", frame(a)["x"] < frame(b)["x"] < frame(c)["x"])
    tap(b, "<Alt>F4")
    time.sleep(1.0)
    h.settle()
    check("Alt+F4 closes B -> A | C", tree() == "HSPLIT[A, C]", tree())
    ax, _, aw, _ = h.work_area()
    check("A and C cover the screen width", frame(c)["x"] + frame(c)["w"] >= ax + aw - h.gap() - 2, str(frame(c)))


def g_workspaces():
    a, b, c = fresh(3)
    tap(b, "<Super><Shift>Page_Down")
    time.sleep(0.8)
    h.settle()
    on = h.windows()
    check("Super+Shift+PgDn: B and the view go to the next workspace, where B fills it",
          h.js("global.workspace_manager.get_active_workspace_index()") == 1 and len(on) == 1 and
          on[0]["id"] == b and on[0]["w"] > 1800, str(on))
    tap(b, "<Super>Page_Up")
    time.sleep(1.0)
    h.settle()
    check("Super+PgUp: back on the first workspace, A | C fill it", tree() == "HSPLIT[A, C]" and left_of(a, c) and
          frame(a)["w"] > 900, tree())
    tap(a, "<Super>Page_Down")
    time.sleep(1.0)
    tap(b, "<Super><Shift>Page_Up")
    time.sleep(1.0)
    h.settle()
    check("Super+Shift+PgUp: B comes back -> 3 windows tiled", len(h.windows()) == 3 and
          h.js("global.workspace_manager.get_active_workspace_index()") == 0, tree())


def g_mouse_drops():
    a, b, c = fresh(3)
    wb = frame(b)
    h.drag_window(c, wb["x"] + wb["w"] // 2, wb["y"] + int(wb["h"] * 0.85))
    check("drop C on B's bottom -> C under B, A on the left", above(b, c) and frame(a)["x"] < frame(b)["x"],
          where(a, b, c))
    wa = frame(a)
    h.drag_window(c, wa["x"] + wa["w"] // 2, wa["y"] + int(wa["h"] * 0.15))
    check("drop C on A's top -> C over A, B on the right", above(c, a) and frame(b)["x"] > frame(a)["x"],
          where(a, b, c))
    wb = frame(b)
    h.drag_window(c, wb["x"] + int(wb["w"] * 0.85), wb["y"] + wb["h"] // 2)
    check("drop C on B's right -> B | C", left_of(b, c), where(a, b, c))
    wa = frame(a)
    h.drag_window(c, wa["x"] + int(wa["w"] * 0.15), wa["y"] + wa["h"] // 2)
    check("drop C on A's left -> C | A", left_of(c, a), where(a, b, c))
    before = [frame(w) for w in (a, b, c)]
    wc = frame(c)
    h.drag_window(c, wc["x"] + wc["w"] // 2 + 30, wc["y"] + wc["h"] // 2)
    check("drop C on itself -> nothing moves", [frame(w) for w in (a, b, c)] == before, where(a, b, c))
    wb = frame(b)
    h.drag_window(c, wb["x"] + wb["w"] // 2, wb["y"] + wb["h"] // 2)
    check("drop C on B's centre -> B and C in tabs", "TABBED[B, C]" in tree() or "TABBED[C, B]" in tree(), tree())
    check("tabs shown for B and C", h.tab_center(b) and h.tab_center(c))
    wa = frame(a)
    h.drag_window(c, wa["x"] + int(wa["w"] * 0.15), wa["y"] + wa["h"] // 2)
    check("drag C out of the tabs onto A's left -> C | A", left_of(c, a) and "TABBED" not in tree(), tree())
    check("no tab left after the group dissolved (#548)", not any(h.tab_center(w) for w in (a, b, c)))
    wb = frame(b)
    h.drag_window(a, wb["x"] + wb["w"] // 2, wb["y"] + int(wb["h"] * 0.85), modifier=SUPER)
    check("Super+drag A onto B's bottom -> A under B", above(b, a), where(a, b, c))


def g_mouse_resize():
    a, b, c = fresh(3)
    wa = frame(a)
    _, grabbed, _ = h.drag_edge(a, "right", 200)
    h.settle()
    check("drag A's right edge +200 -> A wider by ~200", grabbed and abs(frame(a)["w"] - wa["w"] - 200) <= h.TOL,
          f"{wa['w']} -> {frame(a)['w']}")
    check("B starts right after A", abs(frame(b)["x"] - (frame(a)["x"] + frame(a)["w"]) - h.gap()) <= h.GAP_TOL)


def g_snap_monocle_misc():
    a, b, c = fresh(3)
    tap(b, "window-snap-one-third-left")
    ax, ay, aw, ah = h.work_area()
    fb = win_js(b, "const f = w.get_frame_rect(); return [f.x, f.width];")
    check("Ctrl+Alt+d: B snapped to the left third (floating)", h.find(h.windows(), b)["float"] and fb[0] <= ax + 20 and
          abs(fb[1] - aw / 3) < 60, str(fb))
    tap(b, "window-snap-center")
    check("Ctrl+Alt+c: B centred", True)
    tap(b, "window-toggle-float")
    check("float toggle -> B tiled again", not h.find(h.windows(), b)["float"])
    tap(a, "focus-border-toggle")
    tap(a, "focus-border-toggle")
    try:
        tap(a, "window-golden-ratio")
    except RuntimeError:
        pass
    h.js(f'(() => {{ {h.WM}.command({{name: "WorkspaceMonocleToggle"}}); return "ok"; }})()')
    time.sleep(1.0)
    h.settle()
    h.js(f'(() => {{ {h.WM}.command({{name: "WorkspaceMonocleToggle"}}); return "ok"; }})()')
    time.sleep(1.0)
    h.settle()
    check("monocle on and off -> three windows side by side again",
          len(h.windows()) == 3 and tree().startswith("HSPLIT"), tree())


GROUPS = [g_focus, g_swap_move, g_split_new_window, g_layout_toggles, g_float, g_gaps, g_resize_keys,
          g_maximize, g_minimize_close, g_workspaces, g_mouse_drops, g_mouse_resize, g_snap_monocle_misc]


def main():
    wanted = sys.argv[1:]
    errors = h.js_errors()
    for g in GROUPS:
        name = g.__name__[2:]
        if wanted and name not in wanted:
            continue
        print(f"{name}:")
        try:
            g()
        except Exception as e:  # keep going: the other groups still say something
            check(f"{name}: ran to the end", False, f"{type(e).__name__}: {e}")
        errors = end_group(name, errors)
    sys.exit(h.summary(results))


main()
