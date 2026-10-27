#!/usr/bin/env python3
"""Focus on hover leaves GNOME Shell's own dialogs alone (forge-ext/forge#483).

With "focus on hover" on, Forge focuses and raises the window under the pointer every 16 ms. It
did that even while a shell dialog had the keyboard (the Alt+F2 run dialog, a Wi-Fi or polkit
password prompt), so typing went to the window under the pointer instead of the dialog.

  22.1  pointer over a window, Alt+F2 dialog open: what is typed ends up in the dialog
  22.2  after the dialog closes, focus on hover works again: the pointer over another window
        focuses it

Run on a fresh sandbox:  sandbox/launch.sh && scenarios/22_hover_focus_modal.py
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


def pointer_to(x, y):
    h.js(f"""(() => {{ globalThis.__hoverDev ??= global.stage.context.get_backend().get_default_seat()
        .create_virtual_device(imports.gi.Clutter.InputDeviceType.POINTER_DEVICE);
        globalThis.__hoverDev.notify_absolute_motion(GLib.get_monotonic_time(), {x}, {y}); return "ok"; }})()""")


def type_text(text):
    """Type `text` (lowercase letters) on a virtual keyboard, to whatever has the keyboard."""
    keys = ", ".join(str(ord(ch)) for ch in text)
    h.js(f"""(() => {{ const kb = global.stage.context.get_backend().get_default_seat()
        .create_virtual_device(imports.gi.Clutter.InputDeviceType.KEYBOARD_DEVICE);
        let t = GLib.get_monotonic_time();
        for (const k of [{keys}]) {{
            kb.notify_keyval(t, k, imports.gi.Clutter.KeyState.PRESSED); t += 20000;
            kb.notify_keyval(t, k, imports.gi.Clutter.KeyState.RELEASED); t += 20000;
        }}
        return "ok"; }})()""")


def focus_id():
    return h.js("global.display.focus_window?.get_id() ?? 0")


def main():
    if h.windows():
        raise SystemExit("sandbox must be fresh (no windows); run sandbox/launch.sh first")
    h.set_forge_setting("focus-on-hover-enabled", True)
    time.sleep(0.5)
    a = new_editor()
    b = new_editor()
    h.settle()
    ws = h.windows()
    a, b = h.find(ws, a["id"]), h.find(ws, b["id"])       # where they are now, side by side
    r = []

    pointer_to(a["x"] + a["w"] // 2, a["y"] + a["h"] // 2)
    time.sleep(0.5)
    h.js('(() => { Main.openRunDialog(); return "ok"; })()')
    time.sleep(1.0)
    type_text("forgetyping")
    time.sleep(1.0)
    text = h.js("Main.runDialog?._entryText?.text ?? '(no dialog)'")
    ok = text == "forgetyping"
    print(f"  {'PASS' if ok else 'FAIL'}  22.1 typed into the run dialog with the pointer over a window: "
          f"dialog has {text!r} (expected 'forgetyping'); focus on window {focus_id() % 1000}")
    r.append(ok)
    h.js('(() => { Main.runDialog?.close(); return "ok"; })()')
    time.sleep(1.0)

    pointer_to(b["x"] + b["w"] // 2, b["y"] + b["h"] // 2)
    time.sleep(0.8)
    ok = focus_id() == b["id"]
    print(f"  {'PASS' if ok else 'FAIL'}  22.2 after the dialog, pointer over the other window: focus on "
          f"{focus_id() % 1000} (expected {b['id'] % 1000})")
    r.append(ok)
    h.set_forge_setting("focus-on-hover-enabled", False)
    h.close_windows()
    sys.exit(h.summary(r))


main()
