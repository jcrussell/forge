#!/bin/bash
# Screencast start/stop wrapper for the Forge E2E suite (forge-qgg).
#
# Launches/stops the long-lived recorder (record-monitor.py) that holds a single
# D-Bus session connection open for the whole pytest run. See record-monitor.py
# for why a one-shot `gdbus call` cannot work (NameOwnerChanged auto-stop).
#
# Usage:
#   record-session.sh start <workpath.webm>     # begin recording
#   record-session.sh stop   [<dest.webm>]      # stop; optionally copy to dest
#
# Idempotent: stop with no live recorder (or called twice) is a clean no-op.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORDER="${SCRIPT_DIR}/record-monitor.py"
PID_FILE="/tmp/forge-recorder.pid"
PATH_FILE="/tmp/forge-recorder.path"
STOP_TIMEOUT=20

cmd="$1"

case "$cmd" in
  start)
    workpath="${2:-/tmp/forge-recording.webm}"
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "[record-session] already recording (pid $(cat "$PID_FILE"))"
      exit 0
    fi
    echo "[record-session] starting recorder -> ${workpath}"
    # Clear any stale resolved-path marker so the readiness poll below only
    # succeeds once THIS recorder confirms recording (record-monitor.py also
    # removes it on startup, but clear it here too to avoid a launch race).
    rm -f "$PATH_FILE"
    python3 "$RECORDER" "$workpath" &
    rec_pid=$!
    echo "$rec_pid" > "$PID_FILE"
    # Readiness: a live process is NOT proof of recording — Route B can sit
    # waiting for a PipeWire stream that never arrives (the forge-6y7 zero-frame
    # failure). Wait for the recorder to write the resolved output path, which it
    # does only after recording actually begins (Route A: Screencast() returned
    # success; Route B: stream arrived and the pipeline reached PLAYING).
    for _ in $(seq 1 20); do
      [ -f "$PATH_FILE" ] && break
      kill -0 "$rec_pid" 2>/dev/null || { echo "[record-session] recorder exited before recording started — see stderr above"; rm -f "$PID_FILE"; exit 1; }
      sleep 0.5
    done
    if [ ! -f "$PATH_FILE" ]; then
      echo "[record-session] recorder did not confirm recording within 10s (no stream/encoder?) — aborting"
      kill -TERM "$rec_pid" 2>/dev/null || true
      rm -f "$PID_FILE"
      exit 1
    fi
    ;;

  stop)
    dest="$2"
    if [ ! -f "$PID_FILE" ]; then
      echo "[record-session] no recorder to stop"
      exit 0
    fi
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "[record-session] stopping recorder (pid $pid)"
      kill -TERM "$pid" 2>/dev/null || true
      # Bounded wait so a hung stop can never stall test teardown.
      for _ in $(seq 1 $((STOP_TIMEOUT * 2))); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -0 "$pid" 2>/dev/null && { echo "[record-session] recorder unresponsive; SIGKILL"; kill -KILL "$pid" 2>/dev/null || true; }
    fi
    rm -f "$PID_FILE"
    # Copy the resolved recording into the results bundle if a dest was given.
    # Using a gnomeshell-owned /tmp workpath + copy sidesteps host bind-mount UID
    # ownership issues on ${RESULTS_DIR}.
    if [ -n "$dest" ]; then
      src="$(cat "$PATH_FILE" 2>/dev/null)"
      [ -z "$src" ] && src="/tmp/forge-recording.webm"
      if [ -s "$src" ]; then
        cp "$src" "$dest" 2>/dev/null && echo "[record-session] saved -> ${dest}" \
          || echo "[record-session] WARN: could not copy ${src} -> ${dest}"
      elif [ -f "$src" ]; then
        echo "[record-session] WARN: recording file is empty (0 bytes) at ${src} — encoder/stream produced no frames"
      else
        echo "[record-session] WARN: no recording file at ${src}"
      fi
    fi
    ;;

  *)
    echo "usage: record-session.sh {start <workpath>|stop [dest]}" >&2
    exit 2
    ;;
esac
