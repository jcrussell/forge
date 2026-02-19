#!/bin/bash
# Shared utilities for E2E test scripts

# Wait for X display to be available
# Usage: wait_for_display [max_wait_seconds]
wait_for_display() {
    local max_wait=${1:-30}
    local waited=0
    local display_num="${DISPLAY_NUM:-99}"
    local socket_path="/tmp/.X11-unix/X${display_num}"

    echo "Waiting for X display :${display_num} (max ${max_wait}s)..."

    while [ $waited -lt $max_wait ]; do
        # Check if socket exists and Xvfb is running
        if [ -e "$socket_path" ] || [ -S "$socket_path" ]; then
            # Try xdpyinfo if available, otherwise just check socket
            if command -v xdpyinfo &>/dev/null; then
                if xdpyinfo -display ":${display_num}" &>/dev/null; then
                    echo "X display ready after ${waited}s"
                    return 0
                fi
            else
                # No xdpyinfo, just verify socket exists
                echo "X display socket exists after ${waited}s"
                return 0
            fi
        fi
        sleep 0.5
        waited=$((waited + 1))
    done

    echo "ERROR: X display failed to start within ${max_wait}s"
    return 1
}

# Wait for GNOME Shell to be ready via D-Bus
# Usage: wait_for_shell [max_wait_seconds]
wait_for_shell() {
    local max_wait=${1:-60}
    local waited=0

    echo "Waiting for GNOME Shell (max ${max_wait}s)..."

    while [ $waited -lt $max_wait ]; do
        if gdbus call --session \
            --dest org.gnome.Shell \
            --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval "1+1" 2>/dev/null | grep -q "true"; then
            echo "GNOME Shell ready after ${waited}s"
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done

    echo "ERROR: GNOME Shell failed to start within ${max_wait}s"
    return 1
}

# Check if Forge extension is loaded and enabled
# Usage: check_forge_extension
# Returns: prints the raw state string; returns 0 if tree is ready
check_forge_extension() {
    local status
    status=$(gdbus call --session \
        --dest org.gnome.Shell \
        --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval \
        "try { const ext = Main.extensionManager.lookup('forge@jmmaranan.com'); ext && ext.stateObj && ext.stateObj.extWm && ext.stateObj.extWm.tree ? 'tree_ready' : (ext && ext.stateObj ? 'stateObj_only' : (ext ? 'ext_state_' + ext.state : 'not_found')); } catch(e) { 'error:' + e; }" 2>/dev/null || echo "(false, 'dbus_error')")

    echo "$status"
    if echo "$status" | grep -q "tree_ready"; then
        return 0
    else
        return 1
    fi
}

# Wait for Forge extension to be fully initialized
# Usage: wait_for_forge_extension [max_wait_seconds]
wait_for_forge_extension() {
    local max_wait=${1:-180}
    local waited=0
    local uuid="forge@jmmaranan.com"

    echo "Waiting for Forge extension to initialize (max ${max_wait}s)..."

    while [ $waited -lt $max_wait ]; do
        local status
        status=$(check_forge_extension 2>/dev/null)

        if echo "$status" | grep -q "tree_ready"; then
            echo "Forge extension fully initialized after ${waited}s"
            return 0
        fi

        # Print diagnostics every 10s
        if [ $((waited % 10)) -eq 0 ] && [ $waited -gt 0 ]; then
            echo "  [${waited}s] Extension status: $status"
            # List enabled extensions for debugging
            gnome-extensions list --enabled 2>/dev/null | head -5 || true
        fi

        # Every 30s, try a disable/re-enable cycle to nudge GNOME Shell
        if [ $((waited % 30)) -eq 0 ] && [ $waited -gt 0 ]; then
            echo "  [${waited}s] Attempting disable/re-enable cycle..."
            gnome-extensions disable "${uuid}" 2>/dev/null || true
            sleep 2
            gnome-extensions enable "${uuid}" 2>/dev/null || true
            sleep 2
            waited=$((waited + 3))
        fi

        sleep 1
        waited=$((waited + 1))
    done

    echo "ERROR: Forge extension not fully initialized after ${max_wait}s"
    return 1
}

# Get GNOME Shell version
# Usage: get_gnome_version
get_gnome_version() {
    local result
    result=$(gdbus call --session \
        --dest org.gnome.Shell \
        --object-path /org/gnome/Shell \
        --method org.freedesktop.DBus.Properties.Get \
        "org.gnome.Shell" "ShellVersion" 2>/dev/null)
    echo "$result" | sed -n "s/.*'\([0-9.]*\)'.*/\1/p"
}

# Print system info for debugging
# Usage: print_system_info
print_system_info() {
    echo "System Information:"
    echo "  DISPLAY: ${DISPLAY:-not set}"
    echo "  DBUS_SESSION_BUS_ADDRESS: ${DBUS_SESSION_BUS_ADDRESS:-not set}"
    echo "  GNOME Shell Version: $(get_gnome_version 2>/dev/null || echo 'unknown')"
    echo "  User: $(whoami)"
    echo "  Working Directory: $(pwd)"
}
