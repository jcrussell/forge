#!/bin/bash
# Start GNOME Shell session for E2E testing/debugging
#
# This script is used by the Makefile's e2e-debug target.
# It assumes:
# 1. Container is running with systemd as PID 1
# 2. D-Bus user bus is available (wait-user-bus.sh completed)
#
# Usage: set-env.sh /app/scripts/start-session.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

DISPLAY_NUM="${DISPLAY_NUM:-99}"
export DISPLAY=":${DISPLAY_NUM}"

echo "=========================================="
echo "Starting GNOME Shell Session"
echo "=========================================="

# Enable the Forge extension if not already enabled
echo "Ensuring Forge extension is enabled..."
gnome-extensions enable forge@jmmaranan.com 2>/dev/null || true

# Check if GNOME Shell is already running via systemd
if systemctl --user is-active "gnome-xsession@:${DISPLAY_NUM}" >/dev/null 2>&1; then
    echo "GNOME Shell session already running"
else
    echo "Starting GNOME Shell via systemd..."
    systemctl --user start "gnome-xsession@:${DISPLAY_NUM}"
fi

# Wait for shell to be ready
wait_for_shell 60 || exit 1

# Wait for Forge extension to initialize
wait_for_forge_extension 30 || echo "WARNING: Forge may not be fully loaded"

# Print system info
print_system_info

echo ""
echo "=========================================="
echo "GNOME Shell session ready!"
echo "To stop: systemctl --user stop gnome-xsession@:${DISPLAY_NUM}"
echo "=========================================="
