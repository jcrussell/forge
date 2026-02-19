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
        js = """
        (function() {
            try {
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
        js = f"""
        (function() {{
            try {{
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
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return 'ERROR';
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return 'ERROR';

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

                // Layout is a string enum value (HSPLIT, VSPLIT, STACKED, TABBED)
                return windowNode.parentNode.layout || 'UNKNOWN';
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

    def invoke_forge_action(self, action: dict, focus_window: str = None) -> str:
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

        Returns:
            Result string from the evaluation.
        """
        action_json = json.dumps(action)
        focus_hint_js = json.dumps(focus_window) if focus_window else "null"
        js = f"""
        (function() {{
            try {{
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return 'Error: Forge not loaded';
                const ext = forge.stateObj;
                if (!ext.extWm) return 'Error: extWm not available';

                const ws = global.workspace_manager.get_active_workspace();
                const wins = ws.list_windows();
                const origFn = global.display.get_focus_window;
                let focusMethod = 'natural';

                if (!origFn.call(global.display) && wins.length > 0) {{
                    const hint = {focus_hint_js};
                    let targetWin = wins[0];
                    if (hint === 'leftmost') {{
                        targetWin = wins.reduce((best, w) =>
                            w.get_frame_rect().x < best.get_frame_rect().x ? w : best, wins[0]);
                    }} else if (hint === 'rightmost') {{
                        targetWin = wins.reduce((best, w) =>
                            w.get_frame_rect().x > best.get_frame_rect().x ? w : best, wins[0]);
                    }} else if (hint === 'topmost') {{
                        targetWin = wins.reduce((best, w) =>
                            w.get_frame_rect().y < best.get_frame_rect().y ? w : best, wins[0]);
                    }} else if (hint === 'bottommost') {{
                        targetWin = wins.reduce((best, w) =>
                            w.get_frame_rect().y > best.get_frame_rect().y ? w : best, wins[0]);
                    }}
                    global.display.get_focus_window = function() {{ return targetWin; }};
                    focusMethod = 'display_override';
                }}

                try {{
                    ext.extWm.command({action_json});
                    return 'OK_' + focusMethod;
                }} finally {{
                    global.display.get_focus_window = origFn;
                }}
            }} catch(e) {{
                return 'Error: ' + e.message;
            }}
        }})();
        """
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
        js = f"""
        (function() {{
            try {{
                const wsMgr = global.workspace_manager;
                const ws = wsMgr.get_active_workspace();
                const windows = ws.list_windows();
                if (windows.length === 0) return 'No windows';
                // Ensure target workspace exists
                while (wsMgr.get_n_workspaces() <= {ws_index}) {{
                    wsMgr.append_new_workspace(false, global.get_current_time());
                }}
                windows[0].change_workspace_by_index({ws_index}, false);
                return 'OK';
            }} catch(e) {{
                return 'Error: ' + e.message;
            }}
        }})();
        """
        return self.eval(js)

    def get_window_count(self) -> int:
        """
        Get the number of tiled windows on the current workspace.

        Returns:
            Number of tiled windows.
        """
        js = """
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return '0';
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return '0';

                function countWindows(node) {
                    if (!node) return 0;
                    if (node.nodeType === 'WINDOW') return 1;
                    let count = 0;
                    for (const child of (node.childNodes || [])) {
                        count += countWindows(child);
                    }
                    return count;
                }

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
        js = f"""
        (function() {{
            try {{
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return 'false';
                const ext = forge.stateObj;
                const skipStr = ext.settings.get_string('workspace-skip-tile');
                if (!skipStr) return 'false';
                const indices = skipStr.split(',');
                for (let i = 0; i < indices.length; i++) {{
                    if (indices[i].trim() === String({ws_index})) return 'true';
                }}
                return 'false';
            }} catch(e) {{
                return 'false';
            }}
        }})();
        """
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
        js = f"""
        (function() {{
            try {{
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return JSON.stringify({{error: 'Forge not loaded'}});
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return JSON.stringify({{error: 'Tree not available'}});

                function findNode(node, wmClass) {{
                    if (!node) return null;
                    if (node.nodeValue?.get_wm_class?.() === wmClass) {{
                        return node;
                    }}
                    for (const child of (node.childNodes || [])) {{
                        const found = findNode(child, wmClass);
                        if (found) return found;
                    }}
                    return null;
                }}

                const windowNode = findNode(ext.extWm.tree.root, '{wm_class}');
                if (!windowNode) return JSON.stringify({{error: 'Window not found in tree'}});

                const parent = windowNode.parentNode;
                return JSON.stringify({{
                    nodeType: windowNode.nodeType,
                    layout: windowNode.layout,
                    parentNodeType: parent?.nodeType || null,
                    parentLayout: parent?.layout || null,
                    siblingCount: parent ? parent.childNodes.length : 0,
                    rect: windowNode.rect ? {{
                        x: windowNode.rect.x,
                        y: windowNode.rect.y,
                        width: windowNode.rect.width,
                        height: windowNode.rect.height
                    }} : null
                }});
            }} catch(e) {{
                return JSON.stringify({{error: e.message}});
            }}
        }})();
        """
        return self.eval(js)

    def get_parent_layout(self, wm_class: str) -> str:
        """
        Get the layout type of a window's parent container.

        Args:
            wm_class: The WM_CLASS of the window.

        Returns:
            Layout type string: 'HSPLIT', 'VSPLIT', 'STACKED', 'TABBED', or 'ERROR'.
        """
        js = f"""
        (function() {{
            try {{
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return 'ERROR';
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return 'ERROR';

                function findNode(node, wmClass) {{
                    if (!node) return null;
                    if (node.nodeValue?.get_wm_class?.() === wmClass) return node;
                    for (const child of (node.childNodes || [])) {{
                        const found = findNode(child, wmClass);
                        if (found) return found;
                    }}
                    return null;
                }}

                const windowNode = findNode(ext.extWm.tree.root, '{wm_class}');
                if (!windowNode || !windowNode.parentNode) return 'NO_NODE';

                return windowNode.parentNode.layout || 'UNKNOWN';
            }} catch(e) {{
                return 'ERROR';
            }}
        }})();
        """
        return self.eval(js)

    def get_sibling_count(self, wm_class: str) -> int:
        """
        Get the number of siblings (including self) in the same container.

        Args:
            wm_class: The WM_CLASS of the window.

        Returns:
            Number of siblings in the same parent container.
        """
        js = f"""
        (function() {{
            try {{
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return '0';
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return '0';

                function findNode(node, wmClass) {{
                    if (!node) return null;
                    if (node.nodeValue?.get_wm_class?.() === wmClass) return node;
                    for (const child of (node.childNodes || [])) {{
                        const found = findNode(child, wmClass);
                        if (found) return found;
                    }}
                    return null;
                }}

                const windowNode = findNode(ext.extWm.tree.root, '{wm_class}');
                if (!windowNode || !windowNode.parentNode) return '0';

                return String(windowNode.parentNode.childNodes.length);
            }} catch(e) {{
                return '0';
            }}
        }})();
        """
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
        js = """
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return JSON.stringify({error: 'Forge not loaded'});
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return JSON.stringify({error: 'Tree not available'});

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

                return JSON.stringify(serializeNode(ext.extWm.tree.root));
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        return self.eval(js)

    def get_focused_node_path(self) -> list:
        """
        Get the path from root to the focused window node.

        Returns:
            List of node types/layouts from root to focused window.
        """
        js = """
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return JSON.stringify({error: 'Forge not loaded'});
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return JSON.stringify({error: 'Tree not available'});

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

                const nodePath = findNodePath(ext.extWm.tree.root, focusWindow);
                return JSON.stringify(nodePath || []);
            } catch(e) {
                return JSON.stringify({error: e.message});
            }
        })();
        """
        return self.eval(js)

    def get_window_siblings(self, wm_class: str) -> list:
        """
        Get information about all siblings in the same container as a window.

        Args:
            wm_class: The WM_CLASS of the window.

        Returns:
            List of sibling info with nodeType, wmClass, and rect.
        """
        js = f"""
        (function() {{
            try {{
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return JSON.stringify({{error: 'Forge not loaded'}});
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return JSON.stringify({{error: 'Tree not available'}});

                function findNode(node, wmClass) {{
                    if (!node) return null;
                    if (node.nodeValue?.get_wm_class?.() === wmClass) return node;
                    for (const child of (node.childNodes || [])) {{
                        const found = findNode(child, wmClass);
                        if (found) return found;
                    }}
                    return null;
                }}

                const windowNode = findNode(ext.extWm.tree.root, '{wm_class}');
                if (!windowNode || !windowNode.parentNode) return JSON.stringify([]);

                const siblings = windowNode.parentNode.childNodes.map(sibling => ({{
                    nodeType: sibling.nodeType,
                    wmClass: sibling.nodeValue?.get_wm_class?.() || null,
                    rect: sibling.rect ? {{
                        x: sibling.rect.x,
                        y: sibling.rect.y,
                        width: sibling.rect.width,
                        height: sibling.rect.height
                    }} : null,
                    childCount: sibling.childNodes ? sibling.childNodes.length : 0
                }}));

                return JSON.stringify(siblings);
            }} catch(e) {{
                return JSON.stringify({{error: e.message}});
            }}
        }})();
        """
        return self.eval(js)

    def verify_tree_integrity(self) -> dict:
        """
        Verify the tree structure is valid (no orphans, proper parent refs).

        Returns:
            Dictionary with 'valid' bool and any 'errors' list.
        """
        js = """
        (function() {
            try {
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return JSON.stringify({valid: false, errors: ['Forge not loaded']});
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return JSON.stringify({valid: false, errors: ['Tree not available']});

                const errors = [];
                const stack = [{node: ext.extWm.tree.root, parent: null, depth: 0}];

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
        return self.eval(js)

    def get_container_children_count(self, wm_class: str) -> dict:
        """
        Get child count info for the container holding a window.

        Useful for verifying nested container structures.

        Args:
            wm_class: The WM_CLASS of a window in the container.

        Returns:
            Dictionary with directChildren and totalDescendants counts.
        """
        js = f"""
        (function() {{
            try {{
                const forge = Main.extensionManager.lookup('forge@jmmaranan.com');
                if (!forge || !forge.stateObj) return JSON.stringify({{error: 'Forge not loaded'}});
                const ext = forge.stateObj;
                if (!ext.extWm || !ext.extWm.tree) return JSON.stringify({{error: 'Tree not available'}});

                function findNode(node, wmClass) {{
                    if (!node) return null;
                    if (node.nodeValue?.get_wm_class?.() === wmClass) return node;
                    for (const child of (node.childNodes || [])) {{
                        const found = findNode(child, wmClass);
                        if (found) return found;
                    }}
                    return null;
                }}

                function countDescendants(node) {{
                    if (!node) return 0;
                    let count = 0;
                    for (const child of (node.childNodes || [])) {{
                        count += 1 + countDescendants(child);
                    }}
                    return count;
                }}

                const windowNode = findNode(ext.extWm.tree.root, '{wm_class}');
                if (!windowNode || !windowNode.parentNode) return JSON.stringify({{error: 'Window or parent not found'}});

                const parent = windowNode.parentNode;
                return JSON.stringify({{
                    directChildren: parent.childNodes.length,
                    totalDescendants: countDescendants(parent),
                    parentLayout: parent.layout,
                    parentNodeType: parent.nodeType
                }});
            }} catch(e) {{
                return JSON.stringify({{error: e.message}});
            }}
        }})();
        """
        return self.eval(js)
