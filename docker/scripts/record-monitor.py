#!/usr/bin/env python3
"""Long-lived screencast recorder for the Forge E2E suite (forge-qgg).

Why a long-lived process? `org.gnome.Shell.Screencast.Screencast()` is scoped to
the *calling* D-Bus connection: GNOME Shell auto-stops the recording on
NameOwnerChanged the instant the caller disconnects. A one-shot `gdbus call`
would therefore produce a ~0-second / empty WebM. So this process opens a single
session-bus connection, starts recording, then idles in a GLib main loop holding
that connection open for the entire pytest run. On SIGTERM/SIGINT it stops
cleanly on the *same* connection and exits.

Two routes (swap via FORGE_E2E_RECORD_ROUTE; default A):
  A  org.gnome.Shell.Screencast  — the shell owns the GStreamer pipeline. Less
     code. Cannot finalize if gnome-shell itself crashes (no pipeline to flush).
  B  org.gnome.Mutter.ScreenCast RecordMonitor + our own
     pipewiresrc -> vp8enc -> webmmux pipeline. Survives a shell crash because we
     own the muxer and can post EOS. Requires the GStreamer GI typelib + pipewire.

The resolved output path is written to /tmp/forge-recorder.path so the wrapping
shell knows the exact file to copy into the results bundle.

Usage: record-monitor.py <output.webm>
"""

import os
import signal
import sys

import gi

gi.require_version("Gio", "2.0")
gi.require_version("GLib", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

FRAMERATE = int(os.environ.get("FORGE_E2E_RECORD_FPS", "15"))
PATH_FILE = "/tmp/forge-recorder.path"
# Explicit VP8/WebM so we don't depend on the shell's default encoder element
# (which has drifted across GNOME versions and may be absent -> 0-byte file).
VP8_PIPELINE = "videoconvert ! vp8enc cpu-used=8 deadline=1 ! queue ! webmmux"


def log(msg):
    print(f"[record-monitor] {msg}", file=sys.stderr, flush=True)


def _write_resolved_path(path):
    try:
        with open(PATH_FILE, "w") as f:
            f.write(path)
    except OSError as e:
        log(f"could not write {PATH_FILE}: {e}")


class RouteA:
    """org.gnome.Shell.Screencast — shell-owned pipeline."""

    def __init__(self, out_path):
        self.out_path = out_path
        self.conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.proxy = Gio.DBusProxy.new_sync(
            self.conn,
            Gio.DBusProxyFlags.NONE,
            None,
            "org.gnome.Shell.Screencast",
            "/org/gnome/Shell/Screencast",
            "org.gnome.Shell.Screencast",
            None,
        )

    def start(self):
        options = {
            "framerate": GLib.Variant("i", FRAMERATE),
            "draw-cursor": GLib.Variant("b", True),
            "pipeline": GLib.Variant("s", VP8_PIPELINE),
        }
        result = self.proxy.call_sync(
            "Screencast",
            GLib.Variant("(sa{sv})", (self.out_path, options)),
            Gio.DBusCallFlags.NONE,
            -1,
            None,
        )
        success, filename = result.unpack()
        if not success:
            log(f"Screencast() returned success=false (filename={filename!r})")
            return False
        log(f"recording (route A) -> {filename}")
        _write_resolved_path(filename or self.out_path)
        return True

    def stop(self):
        # The shell owns and finalizes its own webmmux; we just ask it to stop.
        # If gnome-shell has crashed this errors out and the file is whatever the
        # shell left behind (truncated) — a known route-A limitation.
        try:
            self.proxy.call_sync(
                "StopScreencast", None, Gio.DBusCallFlags.NONE, -1, None
            )
            log("StopScreencast sent")
        except GLib.Error as e:
            log(f"StopScreencast failed: {e.message}")


class RouteB:
    """org.gnome.Mutter.ScreenCast RecordMonitor + our own GStreamer pipeline."""

    def __init__(self, out_path):
        self.out_path = out_path
        self.pipeline = None
        self.conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self._session_path = None
        self._stream_path = None

    def _connector(self):
        """Pick a monitor connector from Mutter DisplayConfig (first one)."""
        dc = Gio.DBusProxy.new_sync(
            self.conn,
            Gio.DBusProxyFlags.NONE,
            None,
            "org.gnome.Mutter.DisplayConfig",
            "/org/gnome/Mutter/DisplayConfig",
            "org.gnome.Mutter.DisplayConfig",
            None,
        )
        state = dc.call_sync(
            "GetCurrentState", None, Gio.DBusCallFlags.NONE, -1, None
        ).unpack()
        # state = (serial, monitors, logical_monitors, properties)
        monitors = state[1]
        # monitors[i] = ((connector, vendor, product, serial), modes, props)
        connector = monitors[0][0][0]
        log(f"recording monitor connector: {connector}")
        return connector

    def start(self):
        try:
            import gi as _gi

            _gi.require_version("Gst", "1.0")
            from gi.repository import Gst

            Gst.init(None)
        except (ValueError, ImportError) as e:
            log(f"GStreamer GI typelib unavailable for route B: {e}")
            return False
        self._Gst = Gst

        sc = Gio.DBusProxy.new_sync(
            self.conn,
            Gio.DBusProxyFlags.NONE,
            None,
            "org.gnome.Mutter.ScreenCast",
            "/org/gnome/Mutter/ScreenCast",
            "org.gnome.Mutter.ScreenCast",
            None,
        )
        self._session_path = sc.call_sync(
            "CreateSession",
            GLib.Variant("(a{sv})", ({},)),
            Gio.DBusCallFlags.NONE,
            -1,
            None,
        ).unpack()[0]

        session = Gio.DBusProxy.new_sync(
            self.conn,
            Gio.DBusProxyFlags.NONE,
            None,
            "org.gnome.Mutter.ScreenCast",
            self._session_path,
            "org.gnome.Mutter.ScreenCast.Session",
            None,
        )
        # cursor-mode 1 = embedded
        stream_props = {"cursor-mode": GLib.Variant("u", 1)}
        self._stream_path = session.call_sync(
            "RecordMonitor",
            GLib.Variant("(sa{sv})", (self._connector(), stream_props)),
            Gio.DBusCallFlags.NONE,
            -1,
            None,
        ).unpack()[0]

        # PipeWireStreamAdded(u node_id) tells us which node to consume.
        self.conn.signal_subscribe(
            None,
            "org.gnome.Mutter.ScreenCast.Stream",
            "PipeWireStreamAdded",
            self._stream_path,
            None,
            Gio.DBusSignalFlags.NONE,
            self._on_stream_added,
        )
        session.call_sync("Start", None, Gio.DBusCallFlags.NONE, -1, None)
        log("route B session started; awaiting PipeWireStreamAdded")
        return True

    def _on_stream_added(self, conn, sender, path, iface, signal_, params):
        node_id = params.unpack()[0]
        Gst = self._Gst
        desc = (
            f"pipewiresrc path={node_id} ! videorate ! "
            f"video/x-raw,framerate={FRAMERATE}/1 ! videoconvert ! "
            f"vp8enc cpu-used=8 deadline=1 ! queue ! webmmux ! "
            f"filesink location={self.out_path}"
        )
        log(f"pipewire node {node_id}; launching: {desc}")
        # parse_launch raises GLib.Error if an element is missing (e.g.
        # pipewiresrc/vp8enc absent). This runs inside a D-Bus signal callback,
        # so let it surface loudly rather than propagate out of the callback;
        # leave self.pipeline=None and DO NOT write the resolved-path marker, so
        # record-session.sh's readiness poll times out and aborts the run.
        try:
            self.pipeline = Gst.parse_launch(desc)
            self.pipeline.set_state(Gst.State.PLAYING)
        except GLib.Error as e:
            self.pipeline = None
            log(f"failed to launch GStreamer pipeline (missing element?): {e}")
            return
        _write_resolved_path(self.out_path)

    def stop(self):
        if not self.pipeline:
            log("route B: no pipeline (stream never arrived)")
            return
        Gst = self._Gst
        # Post EOS so webmmux writes its cues/duration, then wait for the bus to
        # confirm before tearing down — NEVER SIGKILL the pipeline.
        self.pipeline.send_event(Gst.Event.new_eos())
        bus = self.pipeline.get_bus()
        bus.timed_pop_filtered(
            5 * Gst.SECOND, Gst.MessageType.EOS | Gst.MessageType.ERROR
        )
        self.pipeline.set_state(Gst.State.NULL)
        log("route B pipeline finalized (EOS)")


def main():
    if len(sys.argv) < 2:
        log("usage: record-monitor.py <output.webm>")
        return 2
    out_path = sys.argv[1]
    route = os.environ.get("FORGE_E2E_RECORD_ROUTE", "A").upper()

    try:
        os.remove(PATH_FILE)
    except FileNotFoundError:
        pass

    try:
        recorder = RouteB(out_path) if route == "B" else RouteA(out_path)
    except GLib.Error as e:
        log(f"failed to construct route {route} recorder: {e.message}")
        return 1

    loop = GLib.MainLoop()

    def on_signal():
        log("stop signal received")
        recorder.stop()
        loop.quit()
        return False

    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, on_signal)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, on_signal)

    if not recorder.start():
        log("recorder failed to start")
        return 1

    loop.run()
    log("exited cleanly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
