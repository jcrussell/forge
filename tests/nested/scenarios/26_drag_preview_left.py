#!/usr/bin/env python3
"""The drop preview of a window drag doesn't stay on screen (forge-ext/forge#529, #433, #175).

While a tiled window is dragged over another, Forge shows a coloured preview of where it will go.
At the end of the drag it removed the preview of the window that had the focus then. If the
dragged window was gone by then (a browser tab dragged back into its window closes the window it
was in) or another window had the focus, the preview stayed on screen until the session ended.

  26.1  A | B; drag A by its title bar over B; A closes during the drag: no preview left
  26.2  A | B; drag A over B; B gets the focus during the drag: no preview left
  26.3  an ordinary drag of A over B: the preview goes away at the end (a guard)

Run on a fresh sandbox:  sandbox/launch.sh && scenarios/26_drag_preview_left.py
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


def previews():
    """Forge's drop previews that are showing: [[style, x, y, w, h], ...]."""
    return json.loads(h.js("""JSON.stringify(global.window_group.get_children()
        .filter(a => a.visible && (a.get_style_class_name?.() ?? "").includes("tilepreview"))
        .map(a => [a.get_style_class_name(), Math.round(a.x), Math.round(a.y), Math.round(a.width), Math.round(a.height)]))"""))


def drag_over(a, b, during=None):
    """Press on A's title bar and drag it to the middle of B (Forge shows a drop preview there)."""
    x0, y0 = a["x"] + a["w"] // 2, a["y"] + 18
    x1, y1 = b["x"] + b["w"] // 2, b["y"] + b["h"] // 2
    return h.run_js_file("drag.js", {"__X0__": x0, "__Y0__": y0, "__DX__": x1 - x0, "__DY__": y1 - y0,
                                     "__STEPS__": 40, "__STEP_MS__": 50}, "__drag", during)


def seen_during(after_s, action=None):
    """For drag_over(during=...): after `after_s` s record the previews showing, then run `action`."""
    box = {}

    def run():
        time.sleep(after_s)
        box["previews"] = previews()
        if action:
            action()
    return run, box


def pair():
    a, b = new_editor(), new_editor()
    ws = h.windows()
    a, b = sorted([h.find(ws, a["id"]), h.find(ws, b["id"])], key=lambda w: w["x"])
    return a, b


def main():
    if h.windows():
        raise SystemExit("sandbox must be fresh (no windows); run sandbox/launch.sh first")
    h.set_forge_setting("preview-hint-enabled", True)
    h.set_forge_setting("auto-split-enabled", False)
    r = []

    def case(name, action_of):
        a, b = pair()
        before = previews()                  # (one left by an earlier case stays for the session)
        run, box = seen_during(1.4, action_of(a, b))
        drag_over(a, b, during=run)
        time.sleep(1.5)
        h.settle()
        left = [p for p in previews() if p not in before]
        box["previews"] = [p for p in box.get("previews", []) if p not in before]
        ok = not left and bool(box.get("previews"))
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: preview during the drag {box.get('previews') or 'none (!)'}; "
              f"left after it: {left or 'none'}")
        r.append(ok)
        h.close_windows()
        time.sleep(1.0)

    case("26.1 the dragged window closes during the drag",
         lambda a, b: lambda: h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {a["id"]})
             .delete(global.get_current_time()); return "ok"; }})()"""))
    case("26.2 another window gets the focus during the drag",
         lambda a, b: lambda: h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {b["id"]})
             .activate(global.get_current_time()); return "ok"; }})()"""))
    case("26.3 an ordinary drag", lambda a, b: None)
    sys.exit(h.summary(r))


main()
