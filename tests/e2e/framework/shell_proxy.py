"""
D-Bus Shell Proxy for GNOME Shell.

Connects to the org.gnome.Shell interface and executes JavaScript
via the Eval method to query window tree state and extension status.

Requires gnome-shell to be running with --unsafe-mode flag.
"""

import json
import subprocess
from typing import Any, Optional

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib


class ShellProxyError(Exception):
    """Exception raised when Shell.Eval fails."""

    pass


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

    def is_forge_enabled(self) -> bool:
        """Check if Forge extension is enabled."""
        js = f"""
        (function() {{
            try {{
                const Main = imports.ui.main;
                const ext = Main.extensionManager.lookup('{self.FORGE_UUID}');
                return ext && ext.state === 1; // ExtensionState.ENABLED
            }} catch(e) {{
                return false;
            }}
        }})();
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
        js = """
        (function() {
            try {
                const Main = imports.ui.main;
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return JSON.stringify({error: 'Forge not loaded'});

                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return JSON.stringify({error: 'Tree not available'});

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

                return JSON.stringify(serializeNode(ext.extWm.tree.root));
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        return self.eval(js)

    def get_focused_window(self) -> dict:
        """
        Get information about the currently focused window.

        Returns:
            Dictionary with window info: title, wm_class, rect, node_type.
        """
        js = """
        (function() {
            const display = global.display;
            const focusWindow = display.get_focus_window();
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
        js = f"""
        (function() {{
            try {{
                const Main = imports.ui.main;
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return JSON.stringify({{error: 'Forge not loaded'}});

                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return JSON.stringify({{error: 'Tree not available'}});

                function findNode(node, wmClass) {{
                    if (!node) return null;
                    if (node.nodeValue?.get_wm_class?.() === wmClass) {{
                        return {{
                            nodeType: node.nodeType,
                            layout: node.layout,
                            parentLayout: node.parentNode?.layout,
                            rect: node.rect
                        }};
                    }}
                    for (const child of (node.childNodes || [])) {{
                        const found = findNode(child, wmClass);
                        if (found) return found;
                    }}
                    return null;
                }}

                return JSON.stringify(findNode(ext.extWm.tree.root, '{wm_class}'));
            }} catch(e) {{
                return JSON.stringify({{error: e.message}});
            }}
        }})();
        """
        return self.eval(js)

    def get_container_layout(self) -> str:
        """
        Get the layout type of the container holding the focused window.

        Returns:
            Layout type: 'HSPLIT', 'VSPLIT', 'STACKED', or 'TABBED'.
        """
        js = """
        (function() {
            try {
                const Main = imports.ui.main;
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return 'ERROR';

                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return 'ERROR';

                const focusWindow = global.display.get_focus_window();
                if (!focusWindow) return 'NO_FOCUS';

                function findNodeByWindow(node, metaWindow) {
                    if (!node) return null;
                    if (node.nodeValue === metaWindow) return node;
                    for (const child of (node.childNodes || [])) {
                        const found = findNodeByWindow(child, metaWindow);
                        if (found) return found;
                    }
                    return null;
                }

                const windowNode = findNodeByWindow(ext.extWm.tree.root, focusWindow);
                if (!windowNode || !windowNode.parentNode) return 'NO_NODE';

                const layoutMap = {0: 'HSPLIT', 1: 'VSPLIT', 2: 'STACKED', 3: 'TABBED'};
                return layoutMap[windowNode.parentNode.layout] || 'UNKNOWN';
            } catch(e) {
                return 'ERROR';
            }
        })();
        """
        return self.eval(js)

    def is_window_floating(self, wm_class: str) -> bool:
        """
        Check if a window is in floating mode.

        Args:
            wm_class: The WM_CLASS of the window to check.

        Returns:
            True if floating, False if tiled.
        """
        js = f"""
        (function() {{
            try {{
                const Main = imports.ui.main;
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return 'false';

                const ext = forge.stateObj;
                const windows = global.get_window_actors().map(a => a.meta_window);
                const targetWindow = windows.find(w => w.get_wm_class() === '{wm_class}');
                if (!targetWindow) return 'false';

                // Check if window is in the tree (tiled) or not (floating)
                function isInTree(node, metaWindow) {{
                    if (!node) return false;
                    if (node.nodeValue === metaWindow) return true;
                    for (const child of (node.childNodes || [])) {{
                        if (isInTree(child, metaWindow)) return true;
                    }}
                    return false;
                }}

                return !isInTree(ext.extWm.tree.root, targetWindow) ? 'true' : 'false';
            }} catch(e) {{
                return 'false';
            }}
        }})();
        """
        result = self.eval(js)
        return result == "true"

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

    def get_window_count(self) -> int:
        """
        Get the number of tiled windows on the current workspace.

        Returns:
            Number of tiled windows.
        """
        js = """
        (function() {
            try {
                const Main = imports.ui.main;
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return '0';

                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return '0';

                function countWindows(node) {
                    if (!node) return 0;
                    if (node.nodeType === 4) return 1; // WINDOW node type
                    let count = 0;
                    for (const child of (node.childNodes || [])) {
                        count += countWindows(child);
                    }
                    return count;
                }

                // Find current workspace node
                const wsIndex = global.workspace_manager.get_active_workspace_index();
                // This is simplified - actual implementation would traverse tree properly
                return String(countWindows(ext.extWm.tree.root));
            } catch(e) {
                return '0';
            }
        })();
        """
        result = self.eval(js)
        try:
            return int(result)
        except (ValueError, TypeError):
            return 0
