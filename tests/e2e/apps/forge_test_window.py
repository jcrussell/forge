#!/usr/bin/env python3
"""Forge e2e test window: one plain GTK4 toplevel per process.

The e2e fixtures launch this instead of a real application. It is deliberately
not a Gtk.Application: it owns no D-Bus name, so every launch is its own process
and a window lives exactly as long as that process. (gnome-text-editor's
single-instance primary idled out between tests and took freshly opened windows
down with it — forge-obka.)

--class sets the X11 WM_CLASS and the Wayland app_id (both come from the GLib
program name). --title gives each window a unique token the fixtures match on.

A dialog is a modal child with transient-for set to the main window, which is
what Forge's dialog float rule keys on, titled "<title> (dialog)". --dialog opens
one at startup; SIGUSR1 opens one later and SIGUSR2 closes it, so a test can
open a dialog over a window that is already tiled.

The process exits when its main window is closed.
"""

import argparse
import signal
import sys

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import GLib  # noqa: E402

DEFAULT_SIZE = (800, 600)
DIALOG_SIZE = (400, 200)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--class", dest="wm_class", default="forge-test-window")
    parser.add_argument("--title", default="Forge Test Window")
    parser.add_argument("--dialog", action="store_true", help="open the dialog at startup")
    args = parser.parse_args()

    # Must happen before GTK initializes the display connection.
    GLib.set_prgname(args.wm_class)
    from gi.repository import Gtk

    loop = GLib.MainLoop()
    main_window = Gtk.Window(title=args.title)
    main_window.set_default_size(*DEFAULT_SIZE)
    main_window.connect("close-request", lambda _w: loop.quit() or False)
    dialog = None

    def open_dialog(*_args):
        nonlocal dialog
        if dialog is None:
            dialog = Gtk.Window(title=f"{args.title} (dialog)")
            dialog.set_default_size(*DIALOG_SIZE)
            dialog.set_transient_for(main_window)
            dialog.set_modal(True)
            dialog.connect("close-request", lambda _w: close_dialog() or True)
            dialog.present()
        return GLib.SOURCE_CONTINUE

    def close_dialog(*_args):
        nonlocal dialog
        if dialog is not None:
            dialog.destroy()
            dialog = None
        return GLib.SOURCE_CONTINUE

    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, open_dialog)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR2, close_dialog)

    main_window.present()
    if args.dialog:
        open_dialog()

    loop.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
