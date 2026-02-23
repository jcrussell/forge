#!/bin/bash
# Start the GNOME Shell session for E2E testing
# This script must be run as root
#
# Supports two modes:
#   X11 mode (GNOME 45-48): Xvfb + gnome-shell --x11
#   Wayland headless mode (GNOME 49+): gnome-shell --headless --wayland --virtual-monitor
#
# Mode is auto-detected based on whether gnome-shell supports --x11.
# Fedora 43+ compiles gnome-shell without X11 support, requiring headless Wayland.
set -e

DISPLAY_NUM="${1:-99}"

# Pre-flight validation
if ! id gnomeshell &>/dev/null; then
    echo "ERROR: 'gnomeshell' user does not exist"
    exit 1
fi

if ! command -v gnome-shell &>/dev/null; then
    echo "ERROR: gnome-shell is not installed"
    exit 1
fi

if ! command -v gdbus &>/dev/null; then
    echo "ERROR: gdbus is not installed"
    exit 1
fi

if ! command -v dbus-daemon &>/dev/null; then
    echo "ERROR: dbus-daemon is not installed (install the dbus-daemon package)"
    exit 1
fi

# Detect session type: X11 or Wayland headless
if gnome-shell --help 2>&1 | grep -q -- '--x11'; then
    SESSION_TYPE="x11"
else
    SESSION_TYPE="wayland"
fi
echo "Session type: $SESSION_TYPE"

# Persist session type so set-env.sh and test scripts can read it
echo "$SESSION_TYPE" > /tmp/forge-session-type
chmod 644 /tmp/forge-session-type

# X11 mode requires Xvfb
if [ "$SESSION_TYPE" = "x11" ] && ! command -v Xvfb &>/dev/null; then
    echo "ERROR: Xvfb is not installed (required for X11 mode)"
    exit 1
fi

USER_ID=$(id -u gnomeshell)
XDG_RUNTIME_DIR="/run/user/${USER_ID}"

# Common environment for running commands as gnomeshell user
BASE_ENV="XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR"

echo "Setting up GNOME Shell session (${SESSION_TYPE} mode)..."

# Create user runtime dir if it doesn't exist
if [ ! -d "$XDG_RUNTIME_DIR" ]; then
    echo "Creating XDG_RUNTIME_DIR..."
    mkdir -p "$XDG_RUNTIME_DIR"
    chown gnomeshell:gnomeshell "$XDG_RUNTIME_DIR"
    chmod 700 "$XDG_RUNTIME_DIR"
fi

# Fix permissions on gnome-shell data directories
echo "Fixing permissions..."
mkdir -p /home/gnomeshell/.local/share/gnome-shell
mkdir -p /home/gnomeshell/.local/share/icc
chown -R gnomeshell:gnomeshell /home/gnomeshell/.local

# Start Xvfb for X11 mode only
if [ "$SESSION_TYPE" = "x11" ]; then
    if ! ps aux 2>/dev/null | grep -v grep | grep -q "Xvfb :${DISPLAY_NUM}"; then
        echo "Starting Xvfb on display :${DISPLAY_NUM}..."
        Xvfb ":${DISPLAY_NUM}" -screen 0 1920x1080x24 -ac &
        sleep 2
    fi
fi

# Start dbus-daemon if socket doesn't exist
BUS_SOCKET="$XDG_RUNTIME_DIR/bus"
if [ ! -S "$BUS_SOCKET" ]; then
    echo "Starting D-Bus session daemon..."
    su - gnomeshell -c "$BASE_ENV DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET dbus-daemon --session --address=unix:path=$BUS_SOCKET --nofork --nopidfile &"
    sleep 1
fi

# Wait for D-Bus to be ready
for i in {1..30}; do
    if [ -S "$BUS_SOCKET" ]; then
        break
    fi
    sleep 0.5
done

if [ ! -S "$BUS_SOCKET" ]; then
    echo "ERROR: D-Bus socket not available at $BUS_SOCKET"
    exit 1
fi

# D-Bus env for all subsequent commands
DBUS_ENV="$BASE_ENV DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET"

# Enable Forge extension via gsettings before starting GNOME Shell
echo "Pre-enabling Forge extension via gsettings..."
su - gnomeshell -c "$DBUS_ENV gsettings set org.gnome.shell enabled-extensions \"['forge@jmmaranan.com']\"" 2>/dev/null || true

# Configure GNOME Shell for headless testing (applies to both X11 and Wayland)
echo "Configuring GNOME Shell for headless testing..."
# Disable animations to reduce Clutter allocation pressure
su - gnomeshell -c "$DBUS_ENV gsettings set org.gnome.desktop.interface enable-animations false" 2>/dev/null || true
# Disable hot corner to prevent accidental overview triggers
su - gnomeshell -c "$DBUS_ENV gsettings set org.gnome.desktop.interface enable-hot-corners false" 2>/dev/null || true
# Use static workspaces to reduce dynamic workspace thumbnail churn
su - gnomeshell -c "$DBUS_ENV gsettings set org.gnome.mutter dynamic-workspaces false" 2>/dev/null || true
su - gnomeshell -c "$DBUS_ENV gsettings set org.gnome.desktop.wm.preferences num-workspaces 2" 2>/dev/null || true
# Disable external search providers to prevent D-Bus cascade when
# org.gnome.Settings.desktop fails (IOErrorEnum: The connection is closed)
su - gnomeshell -c "$DBUS_ENV gsettings set org.gnome.desktop.search-providers disable-external true" 2>/dev/null || true

# Start GNOME Shell if not already running
if ! ps -u gnomeshell 2>/dev/null | grep -q "gnome-shell"; then
    if [ "$SESSION_TYPE" = "x11" ]; then
        echo "Starting GNOME Shell (X11 on :${DISPLAY_NUM})..."
        # MUTTER_DEBUG_DUMMY_MONITOR_SCALES: avoids monitor scale warnings
        # CLUTTER_VBLANK=none: prevents vblank waiting (no GPU in Xvfb)
        su - gnomeshell -c "DISPLAY=:${DISPLAY_NUM} $DBUS_ENV MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1 CLUTTER_VBLANK=none gnome-shell --x11 --unsafe-mode > /tmp/gnome-shell.log 2>&1 &"
    else
        echo "Starting GNOME Shell (headless Wayland)..."
        su - gnomeshell -c "$DBUS_ENV gnome-shell --headless --wayland --virtual-monitor 1920x1080 --unsafe-mode > /tmp/gnome-shell.log 2>&1 &"
    fi
    sleep 5
fi

# For Wayland mode, detect the Wayland display socket
if [ "$SESSION_TYPE" = "wayland" ]; then
    echo "Waiting for Wayland display socket..."
    WAYLAND_DISPLAY=""
    for i in {1..30}; do
        for f in "$XDG_RUNTIME_DIR"/wayland-*; do
            if [ -S "$f" ]; then
                WAYLAND_DISPLAY=$(basename "$f")
                break 2
            fi
        done
        sleep 0.5
    done
    if [ -n "$WAYLAND_DISPLAY" ]; then
        echo "Wayland display: $WAYLAND_DISPLAY"
        echo "$WAYLAND_DISPLAY" > /tmp/forge-wayland-display
        chmod 644 /tmp/forge-wayland-display
    else
        echo "WARNING: No Wayland display socket found"
    fi
fi

# Wait for GNOME Shell to be ready via D-Bus
echo "Waiting for GNOME Shell to initialize..."
SHELL_READY=0
for i in {1..30}; do
    if su - gnomeshell -c "$DBUS_ENV gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval '1+1'" 2>/dev/null | grep -q "true"; then
        SHELL_READY=1
        break
    fi
    sleep 1
done

if [ $SHELL_READY -eq 0 ]; then
    echo "ERROR: GNOME Shell failed to start"
    # Print diagnostic info
    echo "--- gnome-shell process status ---"
    ps aux 2>/dev/null | grep gnome-shell || echo "(no gnome-shell process found)"
    echo "--- journal errors ---"
    journalctl --no-pager -n 20 2>/dev/null || true
    exit 1
fi

# Enable the Forge extension via gnome-extensions CLI
echo "Enabling Forge extension..."
FORGE_UUID="forge@jmmaranan.com"

su - gnomeshell -c "$DBUS_ENV gnome-extensions enable ${FORGE_UUID}" 2>&1 || true

# Re-enable after a delay: GNOME Shell may not process the first enable
# if extensions are still loading during early shell startup
sleep 5
su - gnomeshell -c "$DBUS_ENV gnome-extensions enable ${FORGE_UUID}" 2>&1 || true

# Wait for extension to be enabled
sleep 2

# Check extension state
EXT_STATE=$(su - gnomeshell -c "$DBUS_ENV gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval 'global.context.unsafe_mode ? 1 : 0'" 2>/dev/null || echo "(-1)")
echo "Unsafe mode: $EXT_STATE"

# List extensions
su - gnomeshell -c "$DBUS_ENV gnome-extensions list --enabled" 2>&1 || true

echo "GNOME Shell session ready (${SESSION_TYPE} mode)"
exit 0
