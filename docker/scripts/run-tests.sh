#!/bin/bash
# Run Forge E2E tests
#
# This script assumes:
# 1. Xvfb is running with DISPLAY set
# 2. D-Bus user session is available
# 3. GNOME Shell is running
#
# Usage: set-env.sh /app/scripts/run-tests.sh [pytest args...]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

PROJECT_DIR="${PROJECT_DIR:-/app}"
TEST_DIR="${PROJECT_DIR}/tests/e2e"
RESULTS_DIR="${PROJECT_DIR}/e2e-results"
PYTEST_ARGS="${*:---verbose}"

# How InputSimulator routes high-level Forge actions: "dbus" (default, contamination-free) or
# "keybinding" (synthetic Clutter super-modifier keypresses). Pass `-e DISPATCH_MODE=keybinding`
# on the `docker exec`. Defaults to dbus so existing lanes are unchanged. See conftest.py's
# --dispatch-mode option and memory mutter-virtualinputdevice-super-modifier-tilesnap for why
# keybinding mode contaminates across test boundaries (forge-ehq).
DISPATCH_MODE="${DISPATCH_MODE:-dbus}"

# Optional pytest marker expression (e.g. PYTEST_MARKER=workflow to run only the
# multi-step workflow lane, or PYTEST_MARKER=fuzz for the live fuzzer). Passed as
# `-e PYTEST_MARKER=...` on the `docker exec` (mirrors DISPATCH_MODE). When unset the
# default lane runs everything EXCEPT the opt-in fuzz lane — registering the `fuzz`
# marker does NOT deselect it, so the exclusion must be explicit here (forge-cnrc).
MARKER_ARGS=()
if [ -n "${PYTEST_MARKER:-}" ]; then
    MARKER_ARGS=(-m "${PYTEST_MARKER}")
else
    MARKER_ARGS=(-m "not fuzz")
fi

# Ensure environment is set for subprocess launching
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

# Force software GL for any app subprocess pytest launches (forge-4wl). The
# session units get this via systemd-run --setenv in start-user-session.sh; this
# covers the test-side `gnome-text-editor --new-window` subprocesses, which
# inherit os.environ via _launch_window.
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
export GALLIUM_DRIVER="${GALLIUM_DRIVER:-llvmpipe}"

# Set display variables based on session type
SESSION_TYPE_FILE="/tmp/forge-session-type"
if [ -f "$SESSION_TYPE_FILE" ] && [ "$(cat $SESSION_TYPE_FILE)" = "wayland" ]; then
    unset DISPLAY
    if [ -z "$WAYLAND_DISPLAY" ]; then
        WAYLAND_DISPLAY_FILE="/tmp/forge-wayland-display"
        if [ -f "$WAYLAND_DISPLAY_FILE" ]; then
            export WAYLAND_DISPLAY="$(cat $WAYLAND_DISPLAY_FILE)"
        fi
    fi
else
    export DISPLAY="${DISPLAY:-:99}"
fi

echo "=========================================="
echo "Forge E2E Test Runner"
echo "=========================================="

# Create results directories
mkdir -p "${RESULTS_DIR}/screenshots"

# Stamp the build-provenance SHA into the results bundle (forge-q0k). This is the
# git SHA the image was built from (baked in at build time via the GIT_SHA
# build-arg), NOT a test-time value — the image has no .git. Any future
# unexplained xfail/xpass anomaly can be traced back to this commit.
echo "${FORGE_BUILD_SHA:-unknown}" > "${RESULTS_DIR}/GIT_SHA.txt"
echo "Build provenance SHA: ${FORGE_BUILD_SHA:-unknown}"

# Print environment info
print_system_info

# Enable the Forge extension if not already enabled
echo "Ensuring Forge extension is enabled..."
gnome-extensions enable forge@jmmaranan.com 2>/dev/null || true

# Wait for GNOME Shell to be fully ready
echo "Waiting for GNOME Shell..."
if ! wait_for_shell 60; then
    echo "ERROR: GNOME Shell not ready"
    exit 1
fi

# Wait for Forge extension to initialize
echo "Waiting for Forge extension..."
if ! wait_for_forge_extension 180; then
    echo "ERROR: Forge extension failed to initialize — tests cannot run"
    exit 1
fi

# Optional screencast recording (forge-qgg, Wayland-only, opt-in via
# FORGE_E2E_RECORD=1). Started here so it brackets the session fixtures' window
# launches. Record to a gnomeshell-owned /tmp path, then copy into RESULTS_DIR on
# stop (sidesteps host bind-mount UID ownership on ${RESULTS_DIR}).
#
# Recording only works on GNOME 50: the default Route A (org.gnome.Shell.Screencast)
# only finalizes a .webm there (which is why `make e2e-test-record` pins GNOME 50).
# On GNOME 49 Route A aborts after the first test and writes nothing — set
# FORGE_E2E_RECORD_ROUTE=B (Mutter.ScreenCast + pipewiresrc) to record on 49.
# The "recording (route A) -> ...undefined" log line is cosmetic on 50 (the file
# is still written); it is NOT the cause of a missing recording.
RECORDING=0
record_stop_safe() {
    [ "$RECORDING" = 1 ] && /app/scripts/record-session.sh stop "${RESULTS_DIR}/recording.webm" || true
    RECORDING=0
    :
}
if [ "${FORGE_E2E_RECORD:-0}" = "1" ] && [ "$(cat /tmp/forge-session-type 2>/dev/null)" = "wayland" ]; then
    if /app/scripts/record-session.sh start "/tmp/forge-recording.webm"; then
        RECORDING=1
        # Backstop only: the explicit stop below handles the normal pass/fail
        # path (`|| TEST_EXIT=$?` already suppresses set -e on test failure).
        trap 'record_stop_safe' EXIT
    fi
fi

# Run tests
echo "=========================================="
echo "Running E2E tests..."
echo "=========================================="

cd "${TEST_DIR}"
export FORGE_E2E_RESULTS_DIR="${RESULTS_DIR}"
python3 -m pytest tests/ ${PYTEST_ARGS} "${MARKER_ARGS[@]}" \
    --dispatch-mode "${DISPATCH_MODE}" \
    --junitxml="${RESULTS_DIR}/junit.xml" || TEST_EXIT=$?

# Stop recording and finalize the WebM before post-processing.
if [ "$RECORDING" = 1 ]; then
    /app/scripts/record-session.sh stop "${RESULTS_DIR}/recording.webm" || true
    RECORDING=0
    trap - EXIT
fi

echo "=========================================="
echo "Tests completed with exit code: ${TEST_EXIT:-0}"
echo "=========================================="

# Surface pass/fail counts and the NAMES of any failing tests directly in the
# run log (and in a top-level summary.txt inside the results artifact), so a red
# CI run doesn't force a dig into junit.xml just to learn which test failed.
# Parses the junit.xml pytest already wrote (stdlib only — no extra dep); the
# parse pattern mirrors .scratch/summarize-lanes.py. Best-effort: never touches
# TEST_EXIT and swallows its own errors so a malformed/missing report can't fail
# the run.
python3 - "${RESULTS_DIR}/junit.xml" "${RESULTS_DIR}/summary.txt" <<'PYEOF' || true
import sys, xml.etree.ElementTree as ET

junit_path, summary_path = sys.argv[1], sys.argv[2]
lines = []
try:
    root = ET.parse(junit_path).getroot()
    suites = root.iter("testsuite")
    tests = failures = errors = skipped = 0
    failing = []
    for ts in suites:
        tests += int(ts.get("tests", 0))
        failures += int(ts.get("failures", 0))
        errors += int(ts.get("errors", 0))
        skipped += int(ts.get("skipped", 0))
    for tc in root.iter("testcase"):
        node = tc.find("failure")
        kind = "FAIL"
        if node is None:
            node = tc.find("error")
            kind = "ERROR"
        if node is None:
            continue
        name = tc.get("name", "?")
        classname = tc.get("classname", "")
        msg = (node.get("message") or "").strip().splitlines()
        msg = msg[0] if msg else ""
        ident = f"{classname}::{name}" if classname else name
        failing.append(f"  [{kind}] {ident}" + (f" — {msg}" if msg else ""))
    passed = tests - failures - errors - skipped
    lines.append("E2E test summary:")
    lines.append(
        f"  {passed} passed, {failures} failed, {errors} errored, "
        f"{skipped} skipped (of {tests})"
    )
    if failing:
        lines.append("Failing tests:")
        lines.extend(failing)
except Exception as e:  # noqa: BLE001 - diagnostic, must never fail the run
    lines = [f"(could not parse {junit_path}: {e})"]

text = "\n".join(lines)
print(text)
try:
    with open(summary_path, "w") as f:
        f.write(text + "\n")
except Exception:
    pass
PYEOF
echo "=========================================="

# Always copy gnome-shell.log + extract forge debug trace for Phase 4 analysis.
cp /tmp/gnome-shell.log "${RESULTS_DIR}/gnome-shell.log" 2>/dev/null || true
grep '\[Forge\]' /tmp/gnome-shell.log > "${RESULTS_DIR}/forge-trace.log" 2>/dev/null || true

# Check if gnome-shell crashed during tests. Probe via gdbus (org.gnome.Shell.Eval),
# the same liveness check lib.sh:wait_for_shell uses. The image ships no procps-ng,
# so ps/pgrep/pidof are all absent — the old `pgrep` check errored and fired a false
# "crashed" warning on every lane (including green ones). gdbus is always present.
if ! gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "1+1" 2>/dev/null | grep -q "true"; then
    echo "=========================================="
    echo "WARNING: gnome-shell crashed during tests!"
    echo "(Full log saved to e2e-results/gnome-shell.log)"
    echo "--- gnome-shell log (last 200 lines) ---"
    tail -200 /tmp/gnome-shell.log 2>/dev/null || echo "(no log file found)"
    echo "--- end gnome-shell log ---"
    echo "=========================================="
fi

# Copy any screenshots to results
if [ -d "${TEST_DIR}/e2e-results/screenshots" ]; then
    cp -r "${TEST_DIR}/e2e-results/screenshots/"* "${RESULTS_DIR}/screenshots/" 2>/dev/null || true
fi

exit ${TEST_EXIT:-0}
