#!/bin/bash
# Set D-Bus and display environment for containerized GNOME Shell testing.
# Derived from gnome-shell-pod (https://github.com/Schneegans/gnome-shell-pod), MIT license.
#
# Reads session type from /tmp/forge-session-type (written by start-user-session.sh)
# and exports the appropriate display variables.
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus

SESSION_TYPE_FILE="/tmp/forge-session-type"
if [ -f "$SESSION_TYPE_FILE" ] && [ "$(cat $SESSION_TYPE_FILE)" = "wayland" ]; then
    # Wayland headless mode: use WAYLAND_DISPLAY, unset DISPLAY
    unset DISPLAY
    WAYLAND_DISPLAY_FILE="/tmp/forge-wayland-display"
    if [ -f "$WAYLAND_DISPLAY_FILE" ]; then
        export WAYLAND_DISPLAY="$(cat $WAYLAND_DISPLAY_FILE)"
    else
        # Fallback: find the Wayland socket
        for f in /run/user/$(id -u)/wayland-*; do
            if [ -S "$f" ]; then
                export WAYLAND_DISPLAY=$(basename "$f")
                break
            fi
        done
    fi
else
    # X11 mode: use DISPLAY
    export DISPLAY=${DISPLAY:-:99}
fi

eval "$@"
