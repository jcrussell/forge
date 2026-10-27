#!/usr/bin/env python3
"""Windows must not be drawn over each other while an app is slow to redraw.

When a layout changes, GNOME shows a Wayland window's new size (and position) only once its app has
drawn a frame at that size. A neighbour that is quicker (an X11 app, which moves at once, or a
faster Wayland app) then takes the space before the slow app has left it, and is drawn over it
until the slow app catches up. While a resize key repeats, the slow app never catches up. Found
on the real desktop (VS Code over Ptyxis by 1016 px for 3.9 s, scenario 07); here with
lib/slowapp.py, an app that takes a fixed time to follow every new size, so it happens on any
machine.

  18.1  [slow Wayland app | fast X11 app]: hold "grow left" on the fast one 2 s
  18.2  [slow Wayland app | fast Wayland app]: the same
  18.3  [fast X11 app | slow Wayland app]: hold "grow right" on the fast one 2 s
  18.4  [slow Wayland app | fast X11 app]: hold "grow right" on the slow one 2 s (the slow app
        grows into the space the fast one gives up: nothing should cover anything)
  18.5  [fast X11 app | slow | slow | slow Wayland app], the last one closes: the others widen and
        shift, each waiting for the one next to it to move (a chain), none over another

Each check: no window partly covered by another (or off-screen) for 50 ms or more (about three
frames) while the key is held and while the layout settles, and none at all once it has settled.
Run on a fresh sandbox:  sandbox/launch.sh && scenarios/18_slow_redraw_overlap.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import harness as h  # noqa: E402

DELAY_MS = 120     # the slow app's time to follow a new size
MAX_MS = 50        # longest overlap allowed (a frame or two of catching up)


def pair(*specs):
    """Open apps side by side; each is (delay_ms, x11). Returns their windows, left to right."""
    known = set()
    wins = []
    for i, (delay, x11) in enumerate(specs):
        h.open_slow_app(delay, x11=x11, title=f"{'slow' if delay else 'fast'} {'X11' if x11 else 'Wayland'} {i + 1}",
                        color="#a53b3b" if delay else "#3b6ea5")
        wins.append(next(w for w in h.windows() if w["id"] not in known))
        known = {w["id"] for w in h.windows()}
    h.ensure_parent_layout(wins[0]["id"], "HSPLIT")
    h.settle()
    ws = h.windows()
    placed = [h.find(ws, w["id"]) for w in wins]
    if [w["x"] for w in placed] != sorted(w["x"] for w in placed):
        raise SystemExit(f"expected the windows left to right: {h.tree_summary()}")
    return placed


def check(name, left, right, held, side):
    """Hold "grow `side`" on the left (held == 0) or right (held == 1) window, watching throughout."""
    wins = pair(left, right)
    h.watch_start("__w18")
    h.hold_keys(wins[held]["id"], h.GROW_KEYS[side], 2000)
    time.sleep(1.5)                                     # the slow app catches up
    h.settle()
    seen = h.watch_stop("__w18", MAX_MS)
    after = h.visible_problems()
    ok = not seen and not after
    shown = "; ".join(t for _d, t in seen[:3]) or "none"
    print(f"  {'PASS' if ok else 'FAIL'}  {name}: hold 'grow {side}' on the "
          f"{'left' if held == 0 else 'right'} window: overlaps of {MAX_MS} ms or more: {shown}"
          f"{f' (+{len(seen) - 3} more)' if len(seen) > 3 else ''}; after settling: {after or 'none'}")
    h.close_windows()
    time.sleep(1.0)
    return ok


def close_last(name, specs):
    """Apps in a row (each (delay_ms, x11)); close the last one while watching."""
    wins = pair(*specs)
    h.watch_start("__w18")
    h.js(f"""(() => {{ global.display.list_all_windows().find(w => w.get_id() === {wins[-1]["id"]})
        .delete(global.get_current_time()); return "ok"; }})()""")
    time.sleep(2.0)
    h.settle()
    seen = h.watch_stop("__w18", MAX_MS)
    after = h.visible_problems()
    ok = not seen and not after
    shown = "; ".join(t for _d, t in seen[:3]) or "none"
    print(f"  {'PASS' if ok else 'FAIL'}  {name}: close the last of {len(specs)} in a row (fast X11 first, then slow): overlaps of "
          f"{MAX_MS} ms or more: {shown}; after settling: {after or 'none'}")
    h.close_windows()
    time.sleep(1.0)
    return ok


def main():
    if h.windows():
        raise SystemExit("sandbox must be fresh (no windows); run sandbox/launch.sh first")
    h.set_forge_setting("auto-split-enabled", False)
    slow, fast_x11, fast_wl = (DELAY_MS, False), (0, True), (0, False)
    r = [
        check("18.1", slow, fast_x11, 1, "left"),
        check("18.2", slow, fast_wl, 1, "left"),
        check("18.3", fast_x11, slow, 0, "right"),
        check("18.4", slow, fast_x11, 0, "right"),
        close_last("18.5", [fast_x11, slow, slow, slow]),
    ]
    sys.exit(h.summary(r))


main()
