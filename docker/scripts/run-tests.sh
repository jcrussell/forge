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
export DISPLAY="${DISPLAY:-:99}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

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
if ! wait_for_forge_extension 30; then
    echo "WARNING: Forge extension may not be fully initialized"
fi

# Run tests
echo "=========================================="
echo "Running E2E tests..."
echo "=========================================="

cd "${TEST_DIR}"
python3 -m pytest tests/ ${PYTEST_ARGS} \
    --junitxml="${RESULTS_DIR}/junit.xml" || TEST_EXIT=$?

echo "=========================================="
echo "Tests completed with exit code: ${TEST_EXIT:-0}"
echo "=========================================="

# Copy any screenshots to results
if [ -d "${TEST_DIR}/e2e-results/screenshots" ]; then
    cp -r "${TEST_DIR}/e2e-results/screenshots/"* "${RESULTS_DIR}/screenshots/" 2>/dev/null || true
fi

exit ${TEST_EXIT:-0}
