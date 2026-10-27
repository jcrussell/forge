#!/usr/bin/env python3
"""A test app that is slow on purpose: it takes --delay-ms to follow every new size.

On Wayland GNOME shows a window's new size (and the position that comes with it) only once the app
has drawn a frame at that size, so this app takes its new place --delay-ms after Forge asks,
every time, like a big terminal or editor on a busy machine. Real apps are only sometimes slow
(Ptyxis took up to a second while a resize key repeated on the 7680 px profile); this one is
always slow, so a scenario can rely on it.

    slowapp.py [--delay-ms 150] [--title T] [--color #rrggbb] [--min-width W] [--min-height H]

Run it under X11 with GDK_BACKEND=x11 (and the sandbox's DISPLAY): X11 windows take their new
place at once, and only their content lags.
"""
import argparse
import time

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import Gio, GLib, Gtk  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--delay-ms", type=int, default=150)
    ap.add_argument("--title", default="Slow app")
    ap.add_argument("--color", default="#3b6ea5")
    ap.add_argument("--min-width", type=int, default=200)
    ap.add_argument("--min-height", type=int, default=150)
    args = ap.parse_args()
    GLib.set_prgname("forge-slowapp")          # WM_CLASS on X11
    rgb = [int(args.color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    app = Gtk.Application(application_id="org.forge.SlowApp", flags=Gio.ApplicationFlags.NON_UNIQUE)

    def draw(_area, cr, width, height):
        cr.set_source_rgb(*rgb)
        cr.paint()
        cr.set_source_rgb(1, 1, 1)
        cr.select_font_face("Sans")
        cr.set_font_size(24)
        cr.move_to(20, 40)
        cr.show_text(f"{args.title}: {args.delay_ms} ms per resize, {width}x{height}")

    last = {}

    def layout(_surface, width, height):
        # A new size from the compositor: take --delay-ms before anything happens with it, as an
        # app busy laying out its content would. (A slow draw alone doesn't do it: GTK 4 commits
        # the new size first.)
        if last.get("size") not in (None, (width, height)):
            time.sleep(args.delay_ms / 1000)
        last["size"] = (width, height)

    def activate(application):
        win = Gtk.ApplicationWindow(application=application, title=args.title)
        win.set_default_size(640, 480)
        area = Gtk.DrawingArea()
        area.set_size_request(args.min_width, args.min_height)
        area.set_draw_func(draw)
        win.set_child(area)
        win.connect("realize", lambda w: w.get_surface().connect("layout", layout))
        win.present()

    app.connect("activate", activate)
    app.run(None)


main()
