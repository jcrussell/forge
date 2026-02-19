#!/bin/bash
# Start the GNOME Shell session for E2E testing
# This script must be run as root
#
# Starts Xvfb, D-Bus daemon, and GNOME Shell directly without going through systemd,
# which is simpler and more reliable in containerized environments.
set -e

DISPLAY_NUM="${1:-99}"
USER_ID=$(id -u gnomeshell)
XDG_RUNTIME_DIR="/run/user/${USER_ID}"

echo "Setting up GNOME Shell session on display :${DISPLAY_NUM}..."

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

# Start Xvfb if not already running (use ps since pgrep may not be installed)
if ! ps aux 2>/dev/null | grep -v grep | grep -q "Xvfb :${DISPLAY_NUM}"; then
    echo "Starting Xvfb on display :${DISPLAY_NUM}..."
    Xvfb ":${DISPLAY_NUM}" -screen 0 1920x1080x24 &
    sleep 2
fi

# Start dbus-daemon if socket doesn't exist
BUS_SOCKET="$XDG_RUNTIME_DIR/bus"
if [ ! -S "$BUS_SOCKET" ]; then
    echo "Starting D-Bus session daemon..."
    su - gnomeshell -c "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET dbus-daemon --session --address=unix:path=$BUS_SOCKET --nofork --nopidfile &" 2>/dev/null
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

# Enable Forge extension via gsettings before starting GNOME Shell
echo "Pre-enabling Forge extension via gsettings..."
su - gnomeshell -c "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET gsettings set org.gnome.shell enabled-extensions \"['forge@jmmaranan.com']\"" 2>/dev/null || true

# Start GNOME Shell if not already running (use ps since pgrep may not be installed)
if ! ps -u gnomeshell 2>/dev/null | grep -q "gnome-shell"; then
    echo "Starting GNOME Shell..."
    su - gnomeshell -c "DISPLAY=:${DISPLAY_NUM} XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET gnome-shell --x11 --unsafe-mode &" 2>/dev/null
    sleep 5
fi

# Wait for GNOME Shell to be ready
echo "Waiting for GNOME Shell to initialize..."
SHELL_READY=0
for i in {1..30}; do
    if su - gnomeshell -c "DISPLAY=:${DISPLAY_NUM} XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval '1+1'" 2>/dev/null | grep -q "true"; then
        SHELL_READY=1
        break
    fi
    sleep 1
done

if [ $SHELL_READY -eq 0 ]; then
    echo "ERROR: GNOME Shell failed to start"
    exit 1
fi

# Enable the Forge extension via gnome-extensions CLI
echo "Enabling Forge extension..."
FORGE_UUID="forge@jmmaranan.com"

# Use gnome-extensions CLI to enable the extension
su - gnomeshell -c "DISPLAY=:${DISPLAY_NUM} XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET gnome-extensions enable ${FORGE_UUID}" 2>&1 || true

# Re-enable after a delay: GNOME Shell may not process the first enable
# if extensions are still loading during early shell startup
sleep 5
su - gnomeshell -c "DISPLAY=:${DISPLAY_NUM} XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET gnome-extensions enable ${FORGE_UUID}" 2>&1 || true

# Wait for extension to be enabled
sleep 2

# Check extension state via Shell.Eval using global.get_extension_manager()
EXT_STATE=$(su - gnomeshell -c "DISPLAY=:${DISPLAY_NUM} XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval 'global.context.unsafe_mode ? 1 : 0'" 2>/dev/null || echo "(-1)")

echo "Unsafe mode: $EXT_STATE"

# List extensions
su - gnomeshell -c "DISPLAY=:${DISPLAY_NUM} XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=unix:path=$BUS_SOCKET gnome-extensions list --enabled" 2>&1 || true

echo "GNOME Shell session ready on display :${DISPLAY_NUM}"
exit 0
