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
check_forge_extension() {
    local status
    # Query extension state via Shell.Eval
    # Extension state 1 = ENABLED, 2 = DISABLED, etc.
    status=$(gdbus call --session \
        --dest org.gnome.Shell \
        --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval \
        "try { const Main = imports.ui.main; const ext = Main.extensionManager.lookup('forge@jmmaranan.com'); ext ? ext.state : -1; } catch(e) { -1; }" 2>/dev/null || echo "(-1,)")

    if echo "$status" | grep -q "(true, '1')"; then
        echo "Forge extension is enabled"
        return 0
    else
        echo "Forge extension status: $status"
        return 1
    fi
}

# Wait for Forge extension to be fully initialized
# Usage: wait_for_forge_extension [max_wait_seconds]
wait_for_forge_extension() {
    local max_wait=${1:-30}
    local waited=0

    echo "Waiting for Forge extension to initialize (max ${max_wait}s)..."

    while [ $waited -lt $max_wait ]; do
        # Check if extension is enabled (state = 1)
        if check_forge_extension 2>/dev/null; then
            # Additional check: verify the tree is available via Main.extensionManager
            local tree_check
            tree_check=$(gdbus call --session \
                --dest org.gnome.Shell \
                --object-path /org/gnome/Shell \
                --method org.gnome.Shell.Eval \
                "try { const Main = imports.ui.main; const ext = Main.extensionManager.lookup('forge@jmmaranan.com'); ext?.stateObj?.extWm?.tree ? 'ready' : 'loading'; } catch(e) { 'error'; }" 2>/dev/null || echo "")

            if echo "$tree_check" | grep -q "ready"; then
                echo "Forge extension fully initialized after ${waited}s"
                return 0
            fi
        fi
        sleep 1
        waited=$((waited + 1))
    done

    echo "WARNING: Forge extension may not be fully initialized after ${max_wait}s"
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
