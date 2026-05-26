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

# Ensure environment is set for subprocess launching
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

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

# Run tests
echo "=========================================="
echo "Running E2E tests..."
echo "=========================================="

cd "${TEST_DIR}"
export FORGE_E2E_RESULTS_DIR="${RESULTS_DIR}"
python3 -m pytest tests/ ${PYTEST_ARGS} \
    --junitxml="${RESULTS_DIR}/junit.xml" || TEST_EXIT=$?

echo "=========================================="
echo "Tests completed with exit code: ${TEST_EXIT:-0}"
echo "=========================================="

# Always copy gnome-shell.log + extract forge debug trace for Phase 4 analysis.
cp /tmp/gnome-shell.log "${RESULTS_DIR}/gnome-shell.log" 2>/dev/null || true
grep '\[Forge\]' /tmp/gnome-shell.log > "${RESULTS_DIR}/forge-trace.log" 2>/dev/null || true

# Check if gnome-shell crashed during tests
if ! pgrep -u gnomeshell gnome-shell > /dev/null 2>&1; then
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
