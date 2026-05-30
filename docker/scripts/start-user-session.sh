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

# Force software GL (llvmpipe) for every session process (forge-4wl). On
# F44/GNOME50 rawhide, gnome-text-editor attempts a ZINK/Vulkan GL path that has
# no device in the headless container; the failing vkCreateInstance probe slows
# the first cold --new-window enough to blow the launch timeout (transient
# first-test ERROR). These vars must be passed via systemd-run --setenv — the
# shell, portal, and editor primary run as transient units that do NOT inherit
# this script's (or the Dockerfile's) environment. Spliced into each unit below.
GL_ENV=(
    --setenv=LIBGL_ALWAYS_SOFTWARE=1
    --setenv=GALLIUM_DRIVER=llvmpipe
)

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
    # Detect a running Xvfb by its X socket (the image has no procps-ng, so
    # ps/pgrep are unavailable); same socket path lib.sh:wait_for_display checks.
    if [ ! -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ]; then
        echo "Starting Xvfb on display :${DISPLAY_NUM}..."
        Xvfb ":${DISPLAY_NUM}" -screen 0 1920x1080x24 -ac &
        sleep 2
    fi
fi

# Start dbus-daemon if socket doesn't exist.
# Launch via systemd-run so the process lives in its own transient service
# under systemd's hierarchy and survives the exit of this bootstrap script.
# Plain `su -c "... &"` puts the daemon in the docker-exec process tree, which
# gets reaped when the exec returns — that took gnome-shell down with it on
# Fedora 43 (headless Wayland), since the failing user@1000.service can't keep
# orphans alive even with lingering enabled.
BUS_SOCKET="$XDG_RUNTIME_DIR/bus"
if [ ! -S "$BUS_SOCKET" ]; then
    echo "Starting D-Bus session daemon..."
    systemd-run --unit=forge-dbus-session --uid=gnomeshell --gid=gnomeshell \
        --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
        --setenv=DBUS_SESSION_BUS_ADDRESS="unix:path=$BUS_SOCKET" \
        dbus-daemon --session --address="unix:path=$BUS_SOCKET" --nofork --nopidfile
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

# Start GNOME Shell as a transient systemd service so it outlives this
# bootstrap script (see dbus-daemon note above for the why).
# Output is captured to /tmp/gnome-shell.log via the wrapping shell so existing
# diagnostics (run-tests.sh tails this file on shell crash) keep working.
# Skip if our gnome-shell unit is already running (no ps/pgrep in the image —
# query the systemd unit we launch below instead).
# Multi-monitor opt-in (forge-a34.1): default to a single 1920x1080 virtual
# monitor; set FORGE_E2E_VIRTUAL_MONITORS=2 to add a second virtual output so
# multi-monitor tiling tests can run. Wayland-headless only — X11/Xvfb here is a
# single screen. Default stays single-monitor so existing lanes are unchanged.
VIRTUAL_MONITOR_ARGS="--virtual-monitor 1920x1080"
if [ "${FORGE_E2E_VIRTUAL_MONITORS:-1}" = "2" ]; then
    VIRTUAL_MONITOR_ARGS="--virtual-monitor 1920x1080 --virtual-monitor 1920x1080"
fi

if ! systemctl is-active --quiet forge-gnome-shell; then
    if [ "$SESSION_TYPE" = "x11" ]; then
        echo "Starting GNOME Shell (X11 on :${DISPLAY_NUM})..."
        # MUTTER_DEBUG_DUMMY_MONITOR_SCALES: avoids monitor scale warnings
        # CLUTTER_VBLANK=none: prevents vblank waiting (no GPU in Xvfb)
        systemd-run --unit=forge-gnome-shell --uid=gnomeshell --gid=gnomeshell \
            --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
            --setenv=DBUS_SESSION_BUS_ADDRESS="unix:path=$BUS_SOCKET" \
            --setenv=DISPLAY=":${DISPLAY_NUM}" \
            --setenv=MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1 \
            --setenv=CLUTTER_VBLANK=none \
            "${GL_ENV[@]}" \
            sh -c "exec gnome-shell --x11 --unsafe-mode >/tmp/gnome-shell.log 2>&1"
    else
        echo "Starting GNOME Shell (headless Wayland)..."
        systemd-run --unit=forge-gnome-shell --uid=gnomeshell --gid=gnomeshell \
            --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
            --setenv=DBUS_SESSION_BUS_ADDRESS="unix:path=$BUS_SOCKET" \
            "${GL_ENV[@]}" \
            sh -c "exec gnome-shell --headless --wayland ${VIRTUAL_MONITOR_ARGS} --unsafe-mode >/tmp/gnome-shell.log 2>&1"
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

# Pre-launch xdg-desktop-portal under the session bus and (if present) Wayland.
# gnome-text-editor on GNOME 50 blocks ~25s per --new-window during
# GApplication.register() while Gtk waits on portal D-Bus methods. Lazy dbus
# activation of org.freedesktop.portal.Desktop never claims the bus name in
# headless containers (no DISPLAY/WAYLAND_DISPLAY/XDG_SESSION_TYPE in dbus's
# exec env), so we start it ourselves with the right environment.
if [ -x /usr/libexec/xdg-desktop-portal ]; then
    if ! gdbus call --address="unix:path=$BUS_SOCKET" \
            --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
            --method org.freedesktop.DBus.NameHasOwner org.freedesktop.portal.Desktop 2>/dev/null \
            | grep -q true; then
        echo "Pre-launching xdg-desktop-portal..."
        PORTAL_ENV=(
            --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR"
            --setenv=DBUS_SESSION_BUS_ADDRESS="unix:path=$BUS_SOCKET"
            --setenv=XDG_CURRENT_DESKTOP=GNOME
            --setenv=XDG_SESSION_TYPE="$SESSION_TYPE"
        )
        if [ "$SESSION_TYPE" = "wayland" ] && [ -n "$WAYLAND_DISPLAY" ]; then
            PORTAL_ENV+=(--setenv=WAYLAND_DISPLAY="$WAYLAND_DISPLAY")
        elif [ "$SESSION_TYPE" = "x11" ]; then
            PORTAL_ENV+=(--setenv=DISPLAY=":${DISPLAY_NUM}")
        fi
        systemd-run --unit=forge-xdg-portal --uid=gnomeshell --gid=gnomeshell \
            "${PORTAL_ENV[@]}" \
            /usr/libexec/xdg-desktop-portal 2>/dev/null || true
    fi
fi

# Pre-launch a persistent gnome-text-editor GApplication primary instance
# (--gapplication-service runs without windows, just holds the bus name).
# Subsequent test `gnome-text-editor --new-window` invocations become remote
# D-Bus calls to this primary, bypassing GApplication.register() entirely.
# Without this, every fresh --new-window blocks ~25s in register() while Gtk
# waits on slow/missing portal calls on Mutter 50 headless Wayland.
if command -v gnome-text-editor &>/dev/null; then
    EDITOR_ENV=(
        --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR"
        --setenv=DBUS_SESSION_BUS_ADDRESS="unix:path=$BUS_SOCKET"
        --setenv=XDG_CURRENT_DESKTOP=GNOME
        --setenv=XDG_SESSION_TYPE="$SESSION_TYPE"
        # Software GL so the editor primary (which renders every --new-window)
        # never attempts the failing ZINK/Vulkan cold path on F44 (forge-4wl).
        "${GL_ENV[@]}"
    )
    if [ "$SESSION_TYPE" = "wayland" ] && [ -n "$WAYLAND_DISPLAY" ]; then
        EDITOR_ENV+=(--setenv=WAYLAND_DISPLAY="$WAYLAND_DISPLAY")
    elif [ "$SESSION_TYPE" = "x11" ]; then
        EDITOR_ENV+=(--setenv=DISPLAY=":${DISPLAY_NUM}")
    fi
    echo "Pre-launching gnome-text-editor GApplication primary..."
    systemd-run --unit=forge-text-editor-primary --uid=gnomeshell --gid=gnomeshell \
        "${EDITOR_ENV[@]}" \
        gnome-text-editor --gapplication-service 2>/dev/null || true
    # Wait for the primary to claim its bus name so test --new-window calls
    # become remote activations instead of racing fresh register().
    EDITOR_NAME_OWNED=0
    for i in {1..60}; do
        if gdbus call --address="unix:path=$BUS_SOCKET" \
                --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
                --method org.freedesktop.DBus.NameHasOwner org.gnome.TextEditor 2>/dev/null \
                | grep -q true; then
            EDITOR_NAME_OWNED=1
            break
        fi
        sleep 0.5
    done
    # NameHasOwner only proves the primary grabbed the bus name. Its
    # GApplication may still be registering actions / loading settings for
    # ~10s after that, and a test --new-window during that window can race
    # silently. Probe a real method — org.gtk.Actions.List on the
    # /org/gnome/TextEditor object — to confirm the GApplication is actually
    # serving requests.
    EDITOR_ACTIONS_READY=0
    for i in {1..60}; do
        if gdbus call --address="unix:path=$BUS_SOCKET" \
                --dest org.gnome.TextEditor --object-path /org/gnome/TextEditor \
                --method org.gtk.Actions.List 2>/dev/null | grep -q '^('; then
            echo "gnome-text-editor primary ready"
            EDITOR_ACTIONS_READY=1
            break
        fi
        sleep 0.5
    done
    # Diagnostic only (no exit / no restart — the pytest warmup fixture + per-test
    # retry/sweep handle a not-yet-ready primary). If either probe exhausted
    # without success, surface it loudly so a later launch-race failure is
    # debuggable from the lane log (forge-0gj). This runs on every lane.
    if [ "$EDITOR_NAME_OWNED" -ne 1 ] || [ "$EDITOR_ACTIONS_READY" -ne 1 ]; then
        echo "WARNING: gnome-text-editor primary not confirmed ready" \
             "(name_owned=$EDITOR_NAME_OWNED actions_ready=$EDITOR_ACTIONS_READY)"
        systemctl status forge-text-editor-primary --no-pager 2>&1 | head -20 || true
        journalctl --no-pager -n 20 -u forge-text-editor-primary 2>/dev/null || true
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
    echo "--- gnome-shell unit status ---"
    systemctl status forge-gnome-shell --no-pager 2>&1 | head -20 || echo "(forge-gnome-shell unit not found)"
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
