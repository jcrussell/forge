"""
D-Bus Shell Proxy for GNOME Shell.

Connects to the org.gnome.Shell interface and executes JavaScript
via the Eval method to query window tree state and extension status.

Requires gnome-shell to be running with --unsafe-mode flag.
"""

import json
import subprocess
import time
from string import Template
from typing import Any, Optional

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib


class ShellProxyError(Exception):
    """Exception raised when Shell.Eval fails."""

    pass


def _forge_root_js(fail_expr: str) -> str:
    """JS prelude that resolves the Forge extension and binds the tree root.

    `class Tree extends Node` and its constructor calls super(NODE_TYPES.ROOT, ...)
    (lib/extension/tree.js), so the Tree instance IS the root node — there is no
    `.root` property. Every tree walk roots at `ext.extWm.tree` itself, named here
    in exactly ONE place so a bad root expression can't be copy-pasted across the
    query helpers again (this was forge-g14: `ext.extWm.tree.root` was undefined at
    13 sites).

    `fail_expr` is the JS returned when Forge or its tree is unavailable; callers
    use different sentinels ('0', '-1', 'ERROR', 'false', JSON error objects).
    """
    return (
        "                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');\n"
        f"                if (!forge || !forge.stateObj) return {fail_expr};\n"
        "                const ext = forge.stateObj;\n"
        f"                if (!ext.extWm || !ext.extWm.tree) return {fail_expr};\n"
        "                const __root = ext.extWm.tree;\n"
    )


# The two genuinely-identical recursive finders, defined once and concatenated into
# eval bodies that need them. `findNodeByClass` returns the matching WINDOW node;
# only windows expose get_wm_class(), so non-window nodes (monitor/workspace/con)
# never match. `findNodeByWindow` matches by Meta.Window identity. Both are
# first-match in pre-order walk (callers needing every match — e.g.
# count_tiled_windows_of_class — keep their own counting walk).
_TREE_WALKERS_JS = """
                function findNodeByClass(node, wmClass) {
                    if (!node) return null;
                    const v = node.nodeValue;
                    if (v && v.get_wm_class && v.get_wm_class() === wmClass) return node;
                    for (const child of (node.childNodes || [])) {
                        const found = findNodeByClass(child, wmClass);
                        if (found) return found;
                    }
                    return null;
                }
                function findNodeByWindow(node, metaWindow) {
                    if (!node) return null;
                    if (node.nodeValue === metaWindow) return node;
                    for (const child of (node.childNodes || [])) {
                        const found = findNodeByWindow(child, metaWindow);
                        if (found) return found;
                    }
                    return null;
                }
"""


class ShellProxy:
    """
    Proxy for interacting with GNOME Shell via D-Bus.

    Uses the org.gnome.Shell.Eval method to execute JavaScript
    and query window/extension state.
    """

    SHELL_BUS_NAME = "org.gnome.Shell"
    SHELL_OBJECT_PATH = "/org/gnome/Shell"
    SHELL_INTERFACE = "org.gnome.Shell"

    FORGE_UUID = "forge@jmmaranan.com"

    def __init__(self, bus_address: Optional[str] = None):
        """
        Initialize the Shell proxy.

        Args:
            bus_address: Optional D-Bus address. If None, uses session bus.
        """
        self._bus_address = bus_address
        self._proxy: Optional[Gio.DBusProxy] = None

    def connect(self) -> None:
        """Connect to GNOME Shell via D-Bus."""
        try:
            if self._bus_address:
                connection = Gio.DBusConnection.new_for_address_sync(
                    self._bus_address,
                    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT,
                    None,
                    None,
                )
            else:
                connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)

            self._proxy = Gio.DBusProxy.new_sync(
                connection,
                Gio.DBusProxyFlags.NONE,
                None,
                self.SHELL_BUS_NAME,
                self.SHELL_OBJECT_PATH,
                self.SHELL_INTERFACE,
                None,
            )
        except GLib.Error as e:
            raise ShellProxyError(f"Failed to connect to GNOME Shell: {e.message}")

    def disconnect(self) -> None:
        """Disconnect from GNOME Shell."""
        self._proxy = None

    def eval(self, js_code: str) -> Any:
        """
        Execute JavaScript code in GNOME Shell.

        Args:
            js_code: JavaScript code to execute.

        Returns:
            The result of the JavaScript evaluation, parsed as JSON if possible.

        Raises:
            ShellProxyError: If the evaluation fails.
        """
        if not self._proxy:
            raise ShellProxyError("Not connected to GNOME Shell")

        try:
            result = self._proxy.call_sync(
                "Eval",
                GLib.Variant("(s)", (js_code,)),
                Gio.DBusCallFlags.NONE,
                -1,
                None,
            )
            success, output = result.unpack()

            if not success:
                raise ShellProxyError(f"Shell.Eval failed: {output}")

            # Shell.Eval returns JavaScript values as strings.
            # When JavaScript returns JSON.stringify(obj), the result is a
            # quoted string like '"[{\"key\":\"value\"}]"'
            # We need to handle this double-encoding.
            if output:
                # First, try to parse as JSON (handles both direct JSON and quoted strings)
                try:
                    parsed = json.loads(output)
                    # If the result is a string that looks like JSON, parse again
                    if isinstance(parsed, str) and (
                        parsed.startswith("{") or parsed.startswith("[")
                    ):
                        try:
                            return json.loads(parsed)
                        except json.JSONDecodeError:
                            return parsed
                    return parsed
                except json.JSONDecodeError:
                    pass
            return output
        except GLib.Error as e:
            raise ShellProxyError(f"D-Bus call failed: {e.message}")

    def wait_for_idle(self, timeout=5.0, interval=0.3, stable_count=3):
        """Wait for gnome-shell to become responsive after heavy operations.

        Polls gnome-shell with a trivial D-Bus eval until it responds
        multiple times consecutively, confirming the main loop is not
        saturated and the rendering pipeline has settled. This prevents
        crashes caused by stacked/tabbed layout toggles overwhelming the
        Clutter rendering pipeline under Xvfb.

        Args:
            timeout: Maximum time to wait in seconds.
            interval: Time between polls in seconds.
            stable_count: Number of consecutive successful pings required
                before considering the shell idle.

        Returns:
            True if shell became responsive, False on timeout.
        """
        start = time.time()
        consecutive = 0
        while time.time() - start < timeout:
            try:
                if self.eval("1") is not None:
                    consecutive += 1
                    if consecutive >= stable_count:
                        return True
                else:
                    consecutive = 0
            except Exception:
                consecutive = 0
            time.sleep(interval)
        return False

    def is_forge_enabled(self) -> bool:
        """Check if Forge extension is enabled."""
        js = """
        (function() {
            try {
                const ext = Main.extensionManager.lookup('forge@jmmaranan.com');
                return ext && ext.state === 1;
            } catch(e) {
                return false;
            }
        })();
        """
        try:
            result = self.eval(js)
            return result == "true" or result is True
        except ShellProxyError:
            return False

    def get_forge_tree(self) -> dict:
        """
        Get the current Forge window tree structure.

        Returns:
            Dictionary representation of the window tree.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("JSON.stringify({error: 'Tree not available'})")
            + """
                function serializeNode(node) {
                    if (!node) return null;
                    return {
                        nodeType: node.nodeType,
                        layout: node.layout,
                        rect: node.rect ? {
                            x: node.rect.x,
                            y: node.rect.y,
                            width: node.rect.width,
                            height: node.rect.height
                        } : null,
                        children: node.childNodes ? node.childNodes.map(serializeNode) : [],
                        windowTitle: node.nodeValue?.title || null,
                        wmClass: node.nodeValue?.get_wm_class ? node.nodeValue.get_wm_class() : null
                    };
                }

                return JSON.stringify(serializeNode(__root));
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        )
        return self.eval(js)

    def get_focused_window(self) -> dict:
        """
        Get information about the currently focused window.

        In Xvfb environments, focus can be lost after xdotool key events.
        This method auto-activates the first window if no window is focused.

        Returns:
            Dictionary with window info: title, wm_class, rect, node_type.
        """
        js = """
        (function() {
            var focusWindow = global.display.get_focus_window();
            if (!focusWindow) {
                var ws = global.workspace_manager.get_active_workspace();
                var windows = ws.list_windows();
                if (windows.length > 0) {
                    windows[0].activate(global.get_current_time());
                    focusWindow = windows[0];
                }
            }
            if (!focusWindow) return JSON.stringify({error: 'No focused window'});

            const rect = focusWindow.get_frame_rect();
            return JSON.stringify({
                title: focusWindow.get_title(),
                wmClass: focusWindow.get_wm_class(),
                rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                }
            });
        })();
        """
        return self.eval(js)

    def get_windows(self) -> list:
        """
        Get list of all windows on the current workspace.

        Returns:
            List of window dictionaries with title, wm_class, rect.
        """
        js = """
        (function() {
            const workspace = global.workspace_manager.get_active_workspace();
            const windows = workspace.list_windows();
            return JSON.stringify(windows.map(w => {
                const rect = w.get_frame_rect();
                return {
                    title: w.get_title(),
                    wmClass: w.get_wm_class(),
                    rect: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height
                    },
                    isFocused: w.has_focus()
                };
            }));
        })();
        """
        return self.eval(js)

    def get_workspace_rect(self) -> dict:
        """
        Get the dimensions of the current workspace (usable area).

        Returns:
            Dictionary with x, y, width, height.
        """
        js = """
        (function() {
            const workspace = global.workspace_manager.get_active_workspace();
            const monitor = global.display.get_primary_monitor();
            const workArea = workspace.get_work_area_for_monitor(monitor);
            return JSON.stringify({
                x: workArea.x,
                y: workArea.y,
                width: workArea.width,
                height: workArea.height
            });
        })();
        """
        return self.eval(js)

    def get_forge_node_for_window(self, wm_class: str) -> dict:
        """
        Get the Forge tree node for a specific window.

        Args:
            wm_class: The WM_CLASS of the window to find.

        Returns:
            Dictionary with node info including layout type.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("JSON.stringify({error: 'Tree not available'})")
            + _TREE_WALKERS_JS
            + f"                const __wmClass = {json.dumps(wm_class)};\n"
            + """
                const node = findNodeByClass(__root, __wmClass);
                if (!node) return JSON.stringify(null);
                return JSON.stringify({
                    nodeType: node.nodeType,
                    layout: node.layout,
                    parentLayout: node.parentNode?.layout,
                    rect: node.rect
                });
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        )
        return self.eval(js)

    def get_container_layout(self) -> str:
        """
        Get the layout type of the container holding the focused window.

        Returns:
            Layout type: 'HSPLIT', 'VSPLIT', 'STACKED', or 'TABBED'.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("'ERROR'")
            + _TREE_WALKERS_JS
            + """
                var focusWindow = global.display.get_focus_window();
                if (!focusWindow) {
                    var ws = global.workspace_manager.get_active_workspace();
                    var wins = ws.list_windows();
                    if (wins.length > 0) {
                        wins[0].activate(global.get_current_time());
                        focusWindow = wins[0];
                    }
                }
                if (!focusWindow) return 'NO_FOCUS';

                const windowNode = findNodeByWindow(__root, focusWindow);
                if (!windowNode || !windowNode.parentNode) return 'NO_NODE';

                // Layout is a string enum value (HSPLIT, VSPLIT, STACKED, TABBED)
                return windowNode.parentNode.layout || 'UNKNOWN';
            } catch(e) {
                return 'ERROR';
            }
        })();
        """
        )
        return self.eval(js)

    def is_window_floating(self, wm_class: str) -> bool:
        """
        Check if a window is in floating mode.

        Float state is the tree node's `mode` (WINDOW_MODES.FLOAT), NOT tree
        membership: the `float` setter (tree.js `set float`) only flips `mode` and
        never detaches the node, so floating windows keep their tree node. We find
        the node via the shared walk and test `mode === 'FLOAT'` (GRAB_TILE/DEFAULT
        therefore read as not-floating), mirroring count_tiled_windows_of_class.

        First-match only: with multiple same-class windows this reports the first in
        walk order (see count_windows_of_class for a count-all variant).

        Args:
            wm_class: The WM_CLASS of the window to check.

        Returns:
            True if floating, False if tiled (or no matching tree node).
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("'false'")
            + _TREE_WALKERS_JS
            + f"                const __wmClass = {json.dumps(wm_class)};\n"
            + """
                const node = findNodeByClass(__root, __wmClass);
                if (!node) return 'false';
                return node.mode === 'FLOAT' ? 'true' : 'false';
            } catch(e) {
                return 'false';
            }
        })();
        """
        )
        result = self.eval(js)
        return result == "true"

    def is_focused_window_floating(self) -> bool:
        """Whether the currently FOCUSED window is floating (resolved by identity).

        is_window_floating(wm_class) is first-match by class, so it's ambiguous
        when several windows share a wm_class (e.g. two gnome-text-editor windows).
        This resolves the focused Meta.Window's own tree node and reads its mode —
        the right check after floating "the focused window".
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("'false'")
            + _TREE_WALKERS_JS
            + """
                const fw = global.display.get_focus_window();
                if (!fw) return 'false';
                const node = findNodeByWindow(__root, fw);
                if (!node) return 'false';
                return node.mode === 'FLOAT' ? 'true' : 'false';
            } catch(e) {
                return 'false';
            }
        })();
        """
        )
        result = self.eval(js)
        return result == "true"

    def count_windows_of_class(self, wm_class: str) -> int:
        """Count windows of a wm_class on the active workspace.

        Unlike is_window_floating/get_forge_node_for_window (first-match only),
        this counts EVERY window of the class — needed to reason about multiple
        same-class windows (forge-a34.2).
        """
        js = Template("""
        (function() {
            try {
                const ws = global.workspace_manager.get_active_workspace();
                const wins = ws.list_windows();
                let n = 0;
                for (const w of wins) {
                    if (w.get_wm_class() === ${wm_class}) n++;
                }
                return String(n);
            } catch(e) { return '-1'; }
        })();
        """).substitute(wm_class=json.dumps(wm_class))
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return -1

    def count_tiled_windows_of_class(self, wm_class: str) -> int:
        """Count tree window-nodes of a wm_class that are NOT floating.

        Float state is the node's mode (WINDOW_MODES.FLOAT), same basis as
        is_window_floating: a floating window KEEPS its tree node (the `float`
        setter only flips `mode`, never detaches), so we count by `mode !== 'FLOAT'`
        across every match rather than first-match. A class-wide FloatClassToggle
        drives this to 0 for the toggled class; toggling again restores the count.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("'-1'")
            + f"                const __wmClass = {json.dumps(wm_class)};\n"
            + """
                let tiled = 0;
                function walk(node) {
                    if (!node) return;
                    const v = node.nodeValue;
                    if (node.nodeType === 'WINDOW' && v && v.get_wm_class &&
                        v.get_wm_class() === __wmClass && node.mode !== 'FLOAT') {
                        tiled++;
                    }
                    for (const c of (node.childNodes || [])) walk(c);
                }
                walk(__root);
                return String(tiled);
            } catch(e) { return '-1'; }
        })();
        """
        )
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return -1

    def get_monitor_count(self) -> int:
        """Return the number of monitors GNOME sees (global.display.get_n_monitors())."""
        js = "(function(){ try { return String(global.display.get_n_monitors()); } catch(e){ return '-1'; } })();"
        try:
            return int(self.eval(js))
        except (ValueError, TypeError):
            return -1

    def move_focused_window_to_monitor(self, monitor_index: int) -> str:
        """Move the focused window to another monitor via Mutter (move_to_monitor)."""
        js = Template("""
        (function() {
            try {
                const w = global.display.get_focus_window();
                if (!w) return 'NO_FOCUS';
                w.move_to_monitor(${monitor_index});
                return 'ok';
            } catch(e) { return 'ERR ' + e; }
        })();
        """).substitute(monitor_index=int(monitor_index))
        return self.eval(js)

    def count_maximized_windows(self) -> int:
        """Count maximized windows on the active workspace, per Mutter's own state.

        Uses feature detection — is_maximized() on Mutter 49+, else
        get_maximized() === BOTH — so it reads Mutter truth on any version without
        a version-number module. This is the independent ground truth that Forge's
        compat.js maximize/unmaximize shims are validated against (forge-bc1).
        """
        js = """
        (function() {
            try {
                const Meta = imports.gi.Meta;
                const ws = global.workspace_manager.get_active_workspace();
                let n = 0;
                for (const w of ws.list_windows()) {
                    const maxed = (typeof w.is_maximized === 'function')
                        ? w.is_maximized()
                        : (w.get_maximized() === Meta.MaximizeFlags.BOTH);
                    if (maxed) n++;
                }
                return String(n);
            } catch(e) { return '-1'; }
        })();
        """
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return -1

    def get_config_dir(self) -> str:
        """Return Forge's user config dir (configMgr.confDir), e.g. ~/.config/forge.

        Read from the live extension so it matches whatever XDG_CONFIG_HOME the
        gnome-shell process uses, rather than guessing the path test-side.
        """
        js = """
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj || !forge.stateObj.configMgr) return '';
                return forge.stateObj.configMgr.confDir;
            } catch(e) { return ''; }
        })();
        """
        return self.eval(js)

    def get_wm_override_classes(self) -> list:
        """Return wmClass values from the WM's CACHED window overrides.

        Reads ext.extWm.windowProps.overrides — the in-memory copy refreshed only
        by ConfigReload / the prefs reload trigger / startup (window.js
        reloadWindowOverrides). This is distinct from get_float_overrides (which
        reads configMgr.windowProps and re-parses windows.json every access), so
        it's the right probe for "did config reload re-read the file?".
        """
        js = """
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj || !forge.stateObj.extWm) return '[]';
                const wp = forge.stateObj.extWm.windowProps;
                const ov = (wp && wp.overrides) ? wp.overrides : [];
                return JSON.stringify(ov.map(o => o.wmClass));
            } catch(e) { return '[]'; }
        })();
        """
        return self.eval(js)

    def get_float_overrides(self) -> list:
        """Return the live window-property overrides array from the extension.

        Reads forge.stateObj.configMgr.windowProps.overrides — the getter
        re-parses windows.json on each access (settings.js) and
        addFloatOverride/removeFloatOverride save synchronously, so this
        reflects current state right after invoke_forge_action returns. NOTE:
        windows.json ships ~40 default overrides, so callers MUST scope
        assertions to a specific wm_class, never to the total count.
        """
        js = """
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj || !forge.stateObj.configMgr) return '[]';
                const props = forge.stateObj.configMgr.windowProps;
                const overrides = (props && props.overrides) ? props.overrides : [];
                return JSON.stringify(overrides);
            } catch(e) { return '[]'; }
        })();
        """
        result = self.eval(js)
        return result if isinstance(result, list) else []

    def remove_class_float_override(self, wm_class: str) -> int:
        """Strip any class-wide float override (no wmId, no wmTitle) for wm_class.

        Teardown helper for class-float tests: a class-wide override is never
        removed by windowDestroy (it calls removeFloatOverride withWmId=true,
        matching only per-instance wmId entries) and clean_workspace never
        touches windows.json — so a test that floats the editor class and then
        fails mid-run would leak a persistent float into every later test.
        Returns the number of overrides removed.
        """
        js = Template("""
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj || !forge.stateObj.configMgr) return '0';
                const cfg = forge.stateObj.configMgr;
                const props = cfg.windowProps;
                const all = (props && props.overrides) ? props.overrides : [];
                const before = all.length;
                props.overrides = all.filter(o => !(
                    o.wmClass === ${wm_class} && !o.wmId && !o.wmTitle && o.mode === 'float'
                ));
                cfg.windowProps = props;
                return String(before - props.overrides.length);
            } catch(e) { return '0'; }
        })();
        """).substitute(wm_class=json.dumps(wm_class))
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return 0

    def close_all_windows(self) -> int:
        """
        Close all windows on the current workspace via D-Bus.

        Returns:
            Number of windows that were closed.
        """
        js = """
        (function() {
            var ws = global.workspace_manager.get_active_workspace();
            var windows = ws.list_windows();
            var count = windows.length;
            windows.forEach(function(w) {
                w.delete(global.get_current_time());
            });
            return count;
        })();
        """
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return 0

    def close_one_window(self) -> int:
        """
        Close one window on the active workspace via D-Bus.

        Returns:
            Number of remaining windows after closing.
        """
        js = """
        (function() {
            var ws = global.workspace_manager.get_active_workspace();
            var windows = ws.list_windows();
            if (windows.length === 0) return '0';
            windows[0].delete(global.get_current_time());
            return String(windows.length - 1);
        })();
        """
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return 0

    def ensure_focus(self) -> bool:
        """
        Ensure a window has focus on the active workspace.

        In Xvfb environments, focus can be lost. This activates the first
        window on the active workspace if nothing is focused.

        Returns:
            True if a window is now focused, False if no windows available.
        """
        js = """
        (function() {
            if (global.display.get_focus_window()) return 'already_focused';
            var ws = global.workspace_manager.get_active_workspace();
            var windows = ws.list_windows();
            if (windows.length === 0) return 'no_windows';
            windows[0].activate(global.get_current_time());
            return 'activated';
        })();
        """
        result = self.eval(js)
        return result in ("already_focused", "activated")

    def invoke_forge_action(
        self, action: dict, focus_window: str = None, also_activate: bool = False
    ) -> str:
        """
        Invoke a Forge command via D-Bus.

        Calls ext.extWm.command(action) on the running Forge extension.
        Overrides global.display.get_focus_window when focus is null in Xvfb.

        Args:
            action: Action dictionary, e.g. {"name": "WindowResizeRight", "amount": 50}
            focus_window: Optional hint for which window to target when focus
                override is needed. Supports position-based selection:
                "leftmost", "rightmost", "topmost", "bottommost".
                When None, picks the first window from the workspace list.
            also_activate: When True (and a hint is given), genuinely focus the
                target window (metaWindow.focus) in addition to the temporary
                get_focus_window override. The override only lasts for the
                synchronous command() call, but actions whose effect is finalized
                asynchronously (notably keyboard resize, which persists the tree
                split-ratio from the window 'size-changed' signal) re-read
                global.display.get_focus_window AFTER it is restored. Without a
                real focus the async handler targets whatever window actually had
                focus (e.g. the last-opened window, a node with no active grab) and
                resets the layout — so the resize never sticks. This was masked
                while the GNOME Overview was visible (real focus was null, so the
                reset path early-returned). See forge-2n0.

        Returns:
            Result string from the evaluation.
        """
        action_json = json.dumps(action)
        focus_hint_js = json.dumps(focus_window) if focus_window else "null"
        also_activate_js = "true" if also_activate else "false"
        js = Template("""
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return 'Error: Forge not loaded';
                const ext = forge.stateObj;
                if (!ext.extWm) return 'Error: extWm not available';

                const ws = global.workspace_manager.get_active_workspace();
                const wins = ws.list_windows();
                const origFn = global.display.get_focus_window;
                let focusMethod = 'natural';
                const hint = ${focus_hint};

                // Override focus when an explicit hint is given (deterministic target
                // regardless of X11/Wayland natural-focus differences), or when natural
                // focus is null (Xvfb loses focus after synthetic input). Without a hint,
                // the historical null-only behavior is preserved.
                if ((hint || !origFn.call(global.display)) && wins.length > 0) {
                    let targetWin = wins[0];
                    if (hint === 'leftmost') {
                        targetWin = wins.reduce((best, w) =>
                            w.get_frame_rect().x < best.get_frame_rect().x ? w : best, wins[0]);
                    } else if (hint === 'rightmost') {
                        targetWin = wins.reduce((best, w) =>
                            w.get_frame_rect().x > best.get_frame_rect().x ? w : best, wins[0]);
                    } else if (hint === 'topmost') {
                        targetWin = wins.reduce((best, w) =>
                            w.get_frame_rect().y < best.get_frame_rect().y ? w : best, wins[0]);
                    } else if (hint === 'bottommost') {
                        targetWin = wins.reduce((best, w) =>
                            w.get_frame_rect().y > best.get_frame_rect().y ? w : best, wins[0]);
                    }
                    global.display.get_focus_window = function() { return targetWin; };
                    focusMethod = hint ? 'hint_override' : 'display_override';
                    // Genuinely focus the target so async finalizers (resize tree
                    // split-ratio update via 'size-changed') see it as the real
                    // focus after the override is restored below (forge-2n0).
                    if (${also_activate}) {
                        try { targetWin.focus(global.get_current_time()); } catch(e) {}
                    }
                }

                try {
                    ext.extWm.command(${action});
                    return 'OK_' + focusMethod;
                } finally {
                    global.display.get_focus_window = origFn;
                }
            } catch(e) {
                return 'Error: ' + e.message;
            }
        })();
        """).substitute(
            focus_hint=focus_hint_js, also_activate=also_activate_js, action=action_json
        )
        result = self.eval(js)
        if isinstance(result, str) and result.startswith("Error:"):
            raise ShellProxyError(
                f"invoke_forge_action({action.get('name', action)}): {result}"
            )
        return result

    def move_window_to_workspace(self, ws_index: int) -> str:
        """
        Move a window on the active workspace to the given workspace index.

        Creates the target workspace if it doesn't exist.

        Args:
            ws_index: Target workspace index.

        Returns:
            Result string.
        """
        js = Template("""
        (function() {
            try {
                const wsMgr = global.workspace_manager;
                const ws = wsMgr.get_active_workspace();
                const windows = ws.list_windows();
                if (windows.length === 0) return 'No windows';
                // Ensure target workspace exists
                while (wsMgr.get_n_workspaces() <= ${ws_index}) {
                    wsMgr.append_new_workspace(false, global.get_current_time());
                }
                windows[0].change_workspace_by_index(${ws_index}, false);
                return 'OK';
            } catch(e) {
                return 'Error: ' + e.message;
            }
        })();
        """).substitute(ws_index=int(ws_index))
        return self.eval(js)

    def get_window_count(self) -> int:
        """
        Get the number of tiled windows on the current workspace.

        Returns:
            Number of tiled windows.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("'0'")
            + """
                function countWindows(node) {
                    if (!node) return 0;
                    if (node.nodeType === 'WINDOW') return 1;
                    let count = 0;
                    for (const child of (node.childNodes || [])) {
                        count += countWindows(child);
                    }
                    return count;
                }

                return String(countWindows(__root));
            } catch(e) {
                return '0';
            }
        })();
        """
        )
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return 0

    # === Workspace Query Methods ===

    def get_active_workspace_index(self) -> int:
        """
        Get the index of the active workspace.

        Returns:
            Zero-based workspace index.
        """
        js = """
        (function() {
            return String(global.workspace_manager.get_active_workspace_index());
        })();
        """
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return 0

    def get_workspace_count(self) -> int:
        """
        Get the total number of workspaces.

        Returns:
            Number of workspaces.
        """
        js = """
        (function() {
            return String(global.workspace_manager.get_n_workspaces());
        })();
        """
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return 1

    def is_workspace_tiling_skipped(self, ws_index: int) -> bool:
        """
        Check if tiling is skipped for a workspace index.

        Args:
            ws_index: Zero-based workspace index.

        Returns:
            True if tiling is skipped for this workspace.
        """
        js = Template("""
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return 'false';
                const ext = forge.stateObj;
                const skipStr = ext.settings.get_string('workspace-skip-tile');
                if (!skipStr) return 'false';
                const indices = skipStr.split(',');
                for (let i = 0; i < indices.length; i++) {
                    if (indices[i].trim() === String(${ws_index})) return 'true';
                }
                return 'false';
            } catch(e) {
                return 'false';
            }
        })();
        """).substitute(ws_index=int(ws_index))
        result = self.eval(js)
        return result == "true" or result is True

    # === Tree Query Methods for Regression Test Validation ===

    def get_node_for_window(self, wm_class: str) -> dict:
        """
        Get the Forge tree node for a window by WM_CLASS.

        Args:
            wm_class: The WM_CLASS of the window to find.

        Returns:
            Dictionary with node info including nodeType, layout, parentLayout,
            siblingCount, and rect.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("JSON.stringify({error: 'Tree not available'})")
            + _TREE_WALKERS_JS
            + f"                const __wmClass = {json.dumps(wm_class)};\n"
            + """
                const windowNode = findNodeByClass(__root, __wmClass);
                if (!windowNode) return JSON.stringify({error: 'Window not found in tree'});

                const parent = windowNode.parentNode;
                return JSON.stringify({
                    nodeType: windowNode.nodeType,
                    layout: windowNode.layout,
                    parentNodeType: parent?.nodeType || null,
                    parentLayout: parent?.layout || null,
                    siblingCount: parent ? parent.childNodes.length : 0,
                    rect: windowNode.rect ? {
                        x: windowNode.rect.x,
                        y: windowNode.rect.y,
                        width: windowNode.rect.width,
                        height: windowNode.rect.height
                    } : null
                });
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        )
        return self.eval(js)

    def get_parent_layout(self, wm_class: str) -> str:
        """
        Get the layout type of a window's parent container.

        Args:
            wm_class: The WM_CLASS of the window.

        Returns:
            Layout type string: 'HSPLIT', 'VSPLIT', 'STACKED', 'TABBED', or 'ERROR'.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("'ERROR'")
            + _TREE_WALKERS_JS
            + f"                const __wmClass = {json.dumps(wm_class)};\n"
            + """
                const windowNode = findNodeByClass(__root, __wmClass);
                if (!windowNode || !windowNode.parentNode) return 'NO_NODE';

                return windowNode.parentNode.layout || 'UNKNOWN';
            } catch(e) {
                return 'ERROR';
            }
        })();
        """
        )
        return self.eval(js)

    def get_sibling_count(self, wm_class: str) -> int:
        """
        Get the number of siblings (including self) in the same container.

        Args:
            wm_class: The WM_CLASS of the window.

        Returns:
            Number of siblings in the same parent container.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("'0'")
            + _TREE_WALKERS_JS
            + f"                const __wmClass = {json.dumps(wm_class)};\n"
            + """
                const windowNode = findNodeByClass(__root, __wmClass);
                if (!windowNode || !windowNode.parentNode) return '0';

                return String(windowNode.parentNode.childNodes.length);
            } catch(e) {
                return '0';
            }
        })();
        """
        )
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return 0

    def get_tree_structure(self) -> dict:
        """
        Get a simplified tree structure for assertions.

        Returns:
            Dictionary with nested structure showing nodeType, layout,
            and children for each node in the tree.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("JSON.stringify({error: 'Tree not available'})")
            + """
                function serializeNode(node, depth = 0) {
                    if (!node || depth > 10) return null;
                    return {
                        nodeType: node.nodeType,
                        layout: node.layout,
                        childCount: node.childNodes ? node.childNodes.length : 0,
                        wmClass: node.nodeValue?.get_wm_class?.() || null,
                        title: node.nodeValue?.title || null,
                        children: node.childNodes ? node.childNodes.map(c => serializeNode(c, depth + 1)) : []
                    };
                }

                return JSON.stringify(serializeNode(__root));
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        )
        return self.eval(js)

    def get_focused_node_path(self) -> list:
        """
        Get the path from root to the focused window node.

        Returns:
            List of node types/layouts from root to focused window.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("JSON.stringify({error: 'Tree not available'})")
            + """
                const focusWindow = global.display.get_focus_window();
                if (!focusWindow) return JSON.stringify({error: 'No focused window'});

                function findNodePath(node, metaWindow, path = []) {
                    if (!node) return null;
                    const currentPath = [...path, {nodeType: node.nodeType, layout: node.layout}];
                    if (node.nodeValue === metaWindow) return currentPath;
                    for (const child of (node.childNodes || [])) {
                        const found = findNodePath(child, metaWindow, currentPath);
                        if (found) return found;
                    }
                    return null;
                }

                const nodePath = findNodePath(__root, focusWindow);
                return JSON.stringify(nodePath || []);
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        )
        return self.eval(js)

    def get_window_siblings(self, wm_class: str) -> list:
        """
        Get information about all siblings in the same container as a window.

        Args:
            wm_class: The WM_CLASS of the window.

        Returns:
            List of sibling info with nodeType, wmClass, and rect.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("JSON.stringify({error: 'Tree not available'})")
            + _TREE_WALKERS_JS
            + f"                const __wmClass = {json.dumps(wm_class)};\n"
            + """
                const windowNode = findNodeByClass(__root, __wmClass);
                if (!windowNode || !windowNode.parentNode) return JSON.stringify([]);

                const siblings = windowNode.parentNode.childNodes.map(sibling => ({
                    nodeType: sibling.nodeType,
                    wmClass: sibling.nodeValue?.get_wm_class?.() || null,
                    rect: sibling.rect ? {
                        x: sibling.rect.x,
                        y: sibling.rect.y,
                        width: sibling.rect.width,
                        height: sibling.rect.height
                    } : null,
                    childCount: sibling.childNodes ? sibling.childNodes.length : 0
                }));

                return JSON.stringify(siblings);
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        )
        return self.eval(js)

    def verify_tree_integrity(self) -> dict:
        """
        Verify the tree structure is valid (no orphans, proper parent refs).

        Returns:
            Dictionary with 'valid' bool and any 'errors' list.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("JSON.stringify({valid: false, errors: ['Tree not available']})")
            + """
                const errors = [];
                // Root's _parent is null (tree.js Node ctor), and the walk seeds
                // parent:null, so the root's parentNode check is null===null (no
                // spurious depth-0 error).
                const stack = [{node: __root, parent: null, depth: 0}];

                while (stack.length > 0) {
                    const item = stack.pop();
                    if (!item.node) continue;
                    if (item.depth > 20) {
                        errors.push('Tree depth exceeds 20 - possible cycle');
                        continue;
                    }
                    if (item.node.parentNode !== item.parent) {
                        errors.push('Node has incorrect parent reference at depth ' + item.depth);
                    }
                    const children = item.node.childNodes || [];
                    for (let i = 0; i < children.length; i++) {
                        stack.push({node: children[i], parent: item.node, depth: item.depth + 1});
                    }
                }

                return JSON.stringify({
                    valid: errors.length === 0,
                    errors: errors
                });
            } catch(e) {
                return JSON.stringify({valid: false, errors: [String(e)]});
            }
        })();
        """
        )
        return self.eval(js)

    # === Virtual Input Methods (Clutter) ===
    # These use Clutter's VirtualInputDevice API via Shell.Eval to simulate
    # keyboard and mouse input. Unlike xdotool, this works in both X11 and
    # Wayland modes because it goes through Clutter's input pipeline directly.
    #
    # Virtual devices are created once and cached in globalThis._forgeTest*
    # to avoid resource exhaustion from creating devices per key press.

    _virtual_devices_initialized = False

    def _ensure_virtual_devices(self) -> None:
        """Create and cache virtual input devices in GNOME Shell's global scope."""
        if self._virtual_devices_initialized:
            return
        js = """(function() {
    const Clutter = imports.gi.Clutter;
    const seat = Clutter.get_default_backend().get_default_seat();
    if (!globalThis._forgeTestVKbd) {
        globalThis._forgeTestVKbd = seat.create_virtual_device(
            Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }
    if (!globalThis._forgeTestVMouse) {
        globalThis._forgeTestVMouse = seat.create_virtual_device(
            Clutter.InputDeviceType.POINTER_DEVICE);
    }
    return 'ok';
})();"""
        self.eval(js)
        self._virtual_devices_initialized = True

    def simulate_key_combo(self, key_spec: str) -> None:
        """
        Simulate a key combination via Clutter virtual input device.

        Args:
            key_spec: Key specification in xdotool format (e.g., 'super+h',
                      'ctrl+shift+a', 'Page_Up').
        """
        self._ensure_virtual_devices()

        parts = key_spec.split("+")
        key = parts[-1]
        modifiers = parts[:-1] if len(parts) > 1 else []

        # Build press/release sequence
        press_lines = []
        release_lines = []

        for mod in modifiers:
            clutter_name = self._to_clutter_keyname(mod)
            press_lines.append(
                f"vkbd.notify_keyval(t, Clutter.KEY_{clutter_name}, "
                f"Clutter.KeyState.PRESSED); t += dt;"
            )
            release_lines.insert(
                0,
                f"vkbd.notify_keyval(t, Clutter.KEY_{clutter_name}, "
                f"Clutter.KeyState.RELEASED); t += dt;",
            )

        clutter_key = self._to_clutter_keyname(key)
        press_lines.append(
            f"vkbd.notify_keyval(t, Clutter.KEY_{clutter_key}, "
            f"Clutter.KeyState.PRESSED); t += dt;"
        )
        release_lines.insert(
            0,
            f"vkbd.notify_keyval(t, Clutter.KEY_{clutter_key}, "
            f"Clutter.KeyState.RELEASED); t += dt;",
        )

        all_lines = "\n    ".join(press_lines + release_lines)
        js = Template("""(function() {
    const Clutter = imports.gi.Clutter;
    const GLib = imports.gi.GLib;
    const vkbd = globalThis._forgeTestVKbd;
    let t = GLib.get_monotonic_time();
    const dt = 10000;
    ${all_lines}
    return 'ok';
})();""").substitute(all_lines=all_lines)
        self.eval(js)

    def simulate_mouse_move(self, x: int, y: int) -> None:
        """Move the virtual mouse pointer to absolute coordinates."""
        self._ensure_virtual_devices()
        js = Template("""(function() {
    const GLib = imports.gi.GLib;
    globalThis._forgeTestVMouse.notify_absolute_motion(GLib.get_monotonic_time(), ${x}, ${y});
    return 'ok';
})();""").substitute(x=x, y=y)
        self.eval(js)

    def simulate_mouse_button(self, button: int, pressed: bool) -> None:
        """
        Press or release a mouse button.

        Args:
            button: Mouse button (1=left, 2=middle, 3=right).
            pressed: True to press, False to release.
        """
        self._ensure_virtual_devices()
        # Map logical button numbers to evdev button codes
        btn_code = {1: 0x110, 2: 0x112, 3: 0x111}.get(button, 0x110)
        state = "PRESSED" if pressed else "RELEASED"
        js = Template("""(function() {
    const Clutter = imports.gi.Clutter;
    const GLib = imports.gi.GLib;
    globalThis._forgeTestVMouse.notify_button(
        GLib.get_monotonic_time(), ${btn_code}, Clutter.ButtonState.${state});
    return 'ok';
})();""").substitute(btn_code=btn_code, state=state)
        self.eval(js)

    def simulate_click(self, x: int, y: int, button: int = 1) -> None:
        """Click at specific coordinates."""
        self._ensure_virtual_devices()
        btn_code = {1: 0x110, 2: 0x112, 3: 0x111}.get(button, 0x110)
        js = Template("""(function() {
    const Clutter = imports.gi.Clutter;
    const GLib = imports.gi.GLib;
    const vm = globalThis._forgeTestVMouse;
    let t = GLib.get_monotonic_time();
    const dt = 10000;
    vm.notify_absolute_motion(t, ${x}, ${y}); t += dt;
    vm.notify_button(t, ${btn_code}, Clutter.ButtonState.PRESSED); t += dt;
    vm.notify_button(t, ${btn_code}, Clutter.ButtonState.RELEASED);
    return 'ok';
})();""").substitute(x=x, y=y, btn_code=btn_code)
        self.eval(js)

    # --- Screencast overlay (forge-eyu) -----------------------------------
    # A persistent on-stage St.Label burned into the recorded screencast so its
    # frames are self-identifying for failure diagnostics. Cached on
    # globalThis._forgeTestOverlay (same approach as the virtual input devices
    # above) so it survives across evals. Parented to uiGroup — NOT addChrome,
    # which would register struts/work-area regions and perturb tiling geometry.
    # Only driven when FORGE_E2E_RECORD=1 (see conftest / input_simulator); a
    # no-op on normal lanes.

    _overlay_test_label = ""

    def set_recording_overlay(self, test_name: str) -> None:
        """Show the current test name in the screencast overlay."""
        self._overlay_test_label = test_name
        self._render_overlay(test_name)

    def set_recording_action(self, action: str) -> None:
        """Append the firing forge action beneath the current test name."""
        label = self._overlay_test_label
        text = f"{label}\n> {action}" if label else f"> {action}"
        self._render_overlay(text)

    def _render_overlay(self, text: str) -> None:
        js_text = json.dumps(text)
        js = (
            "(function(){"
            "const St=imports.gi.St;"
            "let o=globalThis._forgeTestOverlay;"
            "if(!o){"
            "o=new St.Label({style_class:'forge-e2e-overlay',"
            "style:'background-color:rgba(0,0,0,0.72);color:#ffffff;"
            "font-size:20px;font-family:monospace;padding:8px 14px;"
            "border-radius:8px;'});"
            "o.clutter_text.set_line_wrap(false);"
            "Main.layoutManager.uiGroup.add_child(o);"
            "globalThis._forgeTestOverlay=o;"
            "}"
            f"o.text={js_text};"
            "const pm=Main.layoutManager.primaryMonitor;"
            "o.set_position(pm.x+20,pm.y+20);"
            "Main.layoutManager.uiGroup.set_child_above_sibling(o,null);"
            "o.show();"
            "return 'ok';})();"
        )
        self.eval(js)

    @staticmethod
    def _to_clutter_keyname(key_name: str) -> str:
        """Convert xdotool key name to Clutter.KEY_* suffix."""
        mapping = {
            "super": "Super_L",
            "ctrl": "Control_L",
            "control": "Control_L",
            "shift": "Shift_L",
            "alt": "Alt_L",
        }
        return mapping.get(key_name.lower(), key_name)

    def get_container_children_count(self, wm_class: str) -> dict:
        """
        Get child count info for the container holding a window.

        Useful for verifying nested container structures.

        Args:
            wm_class: The WM_CLASS of a window in the container.

        Returns:
            Dictionary with directChildren and totalDescendants counts.
        """
        js = (
            "        (function() {\n            try {\n"
            + _forge_root_js("JSON.stringify({error: 'Tree not available'})")
            + _TREE_WALKERS_JS
            + f"                const __wmClass = {json.dumps(wm_class)};\n"
            + """
                function countDescendants(node) {
                    if (!node) return 0;
                    let count = 0;
                    for (const child of (node.childNodes || [])) {
                        count += 1 + countDescendants(child);
                    }
                    return count;
                }

                const windowNode = findNodeByClass(__root, __wmClass);
                if (!windowNode || !windowNode.parentNode) return JSON.stringify({error: 'Window or parent not found'});

                const parent = windowNode.parentNode;
                return JSON.stringify({
                    directChildren: parent.childNodes.length,
                    totalDescendants: countDescendants(parent),
                    parentLayout: parent.layout,
                    parentNodeType: parent.nodeType
                });
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        )
        return self.eval(js)
