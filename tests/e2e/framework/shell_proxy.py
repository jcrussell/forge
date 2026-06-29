"""
D-Bus Shell Proxy for GNOME Shell.

Connects to the org.gnome.Shell interface and executes JavaScript
via the Eval method to query window tree state and extension status.

Requires gnome-shell to be running with --unsafe-mode flag.
"""

import json
import subprocess
import time
from pathlib import Path
from string import Template
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

    # Injected test bridge (forge-1gu). The JS lives in bridge.js next to this file and is
    # sent once per connection; see _ensure_bridge().
    BRIDGE_JS_PATH = Path(__file__).parent / "bridge.js"

    def __init__(self, bus_address: Optional[str] = None):
        """
        Initialize the Shell proxy.

        Args:
            bus_address: Optional D-Bus address. If None, uses session bus.
        """
        self._bus_address = bus_address
        self._proxy: Optional[Gio.DBusProxy] = None
        # Primary guard for the inject-once test bridge. The shell can't self-reinstall (the
        # source lives here, in the Python process), so this Python flag — not a JS-side check —
        # is what prevents re-sending bridge.js on every query. Reset in disconnect(). Since
        # forge-9q3 this is the SINGLE install flag: the virtual-input devices and screencast
        # overlay are bridge methods (ensureVirtualDevices/renderOverlay), so they ride this
        # one inject-once mechanism instead of carrying their own (never-reset) flags.
        self._bridge_installed = False
        # Current test name shown in the screencast overlay; the firing action is appended
        # beneath it (set_recording_action). Instance state, not a stale-able install flag.
        self._overlay_test_label = ""

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
        # gnome-shell's Eval global is cleared on a shell restart, so a fresh connection must
        # re-inject. Resetting this one flag re-arms the WHOLE bridge — query methods, virtual
        # devices, and overlay — fixing the old stale-device-on-reconnect bug (forge-9q3), where
        # a separate never-reset flag left cached device refs pointing at a wiped globalThis.
        self._bridge_installed = False

    def _ensure_bridge(self) -> None:
        """Inject the test bridge (bridge.js) into the shell's Eval global, once per connection.

        A single Python flag gates a single eval that installs globalThis._forgeTestBridge;
        later query/input/overlay methods just call its methods (forge-9q3 folded the virtual
        devices and overlay in here too, so this is now the ONE inject-once mechanism). The
        install eval returns the plain sentinel 'ok' so eval()'s JSON parser doesn't
        mis-read object text — assert on it so a syntax error in bridge.js fails loud here rather
        than surfacing later as every query returning its failure sentinel.
        """
        if self._bridge_installed:
            return
        bridge_js = self.BRIDGE_JS_PATH.read_text()
        result = self.eval(bridge_js)
        if result != "ok":
            raise ShellProxyError(f"Test bridge install did not return 'ok' (got {result!r})")
        self._bridge_installed = True

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
        try:
            self._ensure_bridge()
            result = self.eval("globalThis._forgeTestBridge.isForgeEnabled()")
            return result == "true" or result is True
        except ShellProxyError:
            return False

    def get_forge_tree(self) -> dict:
        """
        Get the current Forge window tree structure.

        Returns:
            Dictionary representation of the window tree.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.getForgeTree()")

    def get_focused_window(self) -> dict:
        """
        Get information about the currently focused window.

        In Xvfb environments, focus can be lost after xdotool key events.
        This method auto-activates the first window if no window is focused.

        Returns:
            Dictionary with window info: title, wm_class, rect, node_type.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.getFocusedWindow()")

    def get_windows(self) -> list:
        """
        Get list of all windows on the current workspace.

        Returns:
            List of window dictionaries with title, wm_class, rect.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.getWindows()")

    def get_workspace_rect(self) -> dict:
        """
        Get the dimensions of the current workspace (usable area).

        Returns:
            Dictionary with x, y, width, height.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.getWorkspaceRect()")

    def get_forge_node_for_window(self, wm_class: str) -> dict:
        """
        Get the Forge tree node for a specific window.

        Args:
            wm_class: The WM_CLASS of the window to find.

        Returns:
            Dictionary with node info including layout type.
        """
        self._ensure_bridge()
        return self.eval(
            "globalThis._forgeTestBridge.getForgeNodeForWindow(%s)" % json.dumps(wm_class)
        )

    def get_container_layout(self) -> str:
        """
        Get the layout type of the container holding the focused window.

        Returns:
            Layout type: 'HSPLIT', 'VSPLIT', 'STACKED', or 'TABBED'.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.getContainerLayout()")

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
        self._ensure_bridge()
        result = self.eval(
            "globalThis._forgeTestBridge.isWindowFloating(%s)" % json.dumps(wm_class)
        )
        return result == "true"

    def is_focused_window_floating(self) -> bool:
        """Whether the currently FOCUSED window is floating (resolved by identity).

        is_window_floating(wm_class) is first-match by class, so it's ambiguous
        when several windows share a wm_class (e.g. two gnome-text-editor windows).
        This resolves the focused Meta.Window's own tree node and reads its mode —
        the right check after floating "the focused window".
        """
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.isFocusedWindowFloating()")
        return result == "true"

    def count_windows_of_class(self, wm_class: str) -> int:
        """Count windows of a wm_class on the active workspace.

        Unlike is_window_floating/get_forge_node_for_window (first-match only),
        this counts EVERY window of the class — needed to reason about multiple
        same-class windows (forge-a34.2).
        """
        self._ensure_bridge()
        result = self.eval(
            "globalThis._forgeTestBridge.countWindowsOfClass(%s)" % json.dumps(wm_class)
        )
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
        self._ensure_bridge()
        result = self.eval(
            "globalThis._forgeTestBridge.countTiledWindowsOfClass(%s)" % json.dumps(wm_class)
        )
        try:
            return int(result)
        except (ValueError, TypeError):
            return -1

    def get_preview_hint_state(self) -> dict:
        """Return drag-preview hint leak state: {"count": n, "visible": n}.

        forge-63y (gh-529): any tree node still holding a previewHint outside an
        active grab is a leak; a non-zero "visible" is the stuck-red-overlay
        shape. Returns {"error": ...} if the tree is unavailable.
        """
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.getPreviewHintState()")
        if isinstance(result, dict):
            return result
        try:
            return json.loads(result)
        except (ValueError, TypeError):
            return {"error": f"unparseable: {result!r}"}

    def get_monitor_count(self) -> int:
        """Return the number of monitors GNOME sees (global.display.get_n_monitors())."""
        self._ensure_bridge()
        try:
            return int(self.eval("globalThis._forgeTestBridge.getMonitorCount()"))
        except (ValueError, TypeError):
            return -1

    def move_focused_window_to_monitor(self, monitor_index: int) -> str:
        """Move the focused window to another monitor via Mutter (move_to_monitor)."""
        self._ensure_bridge()
        return self.eval(
            "globalThis._forgeTestBridge.moveFocusedWindowToMonitor(%d)" % int(monitor_index)
        )

    def count_maximized_windows(self) -> int:
        """Count maximized windows on the active workspace, per Mutter's own state.

        Uses feature detection — is_maximized() on Mutter 49+, else
        get_maximized() === BOTH — so it reads Mutter truth on any version without
        a version-number module. This is the independent ground truth that Forge's
        compat.js maximize/unmaximize shims are validated against (forge-bc1).
        """
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.countMaximizedWindows()")
        try:
            return int(result)
        except (ValueError, TypeError):
            return -1

    def get_config_dir(self) -> str:
        """Return Forge's user config dir (configMgr.confDir), e.g. ~/.config/forge.

        Read from the live extension so it matches whatever XDG_CONFIG_HOME the
        gnome-shell process uses, rather than guessing the path test-side.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.getConfigDir()")

    def get_wm_override_classes(self) -> list:
        """Return wmClass values from the WM's CACHED window overrides.

        Reads ext.extWm.windowProps.overrides — the in-memory copy refreshed only
        by ConfigReload / the prefs reload trigger / startup (window.js
        reloadWindowOverrides). This is distinct from get_float_overrides (which
        reads configMgr.windowProps and re-parses windows.json every access), so
        it's the right probe for "did config reload re-read the file?".
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.getWmOverrideClasses()")

    def get_float_overrides(self) -> list:
        """Return the live window-property overrides array from the extension.

        Reads forge.stateObj.configMgr.windowProps.overrides — the getter
        re-parses windows.json on each access (settings.js) and
        addFloatOverride/removeFloatOverride save synchronously, so this
        reflects current state right after invoke_forge_action returns. NOTE:
        windows.json ships ~40 default overrides, so callers MUST scope
        assertions to a specific wm_class, never to the total count.
        """
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.getFloatOverrides()")
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
        self._ensure_bridge()
        result = self.eval(
            "globalThis._forgeTestBridge.removeClassFloatOverride(%s)" % json.dumps(wm_class)
        )
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
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.closeAllWindows()")
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
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.closeOneWindow()")
        try:
            return int(result)
        except (ValueError, TypeError):
            return 0

    def close_focused_window(self) -> str:
        """
        Close the currently focused window via Mutter's delete() (reliable on all
        supported versions, unlike a synthetic alt+F4).

        Returns:
            The closed window's id as a string, or "no_focus" if none was focused.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.closeFocusedWindow()")

    def ensure_focus(self) -> bool:
        """
        Ensure a window has focus on the active workspace.

        In Xvfb environments, focus can be lost. This activates the first
        window on the active workspace if nothing is focused.

        Returns:
            True if a window is now focused, False if no windows available.
        """
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.ensureFocus()")
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
        self._ensure_bridge()
        result = self.eval(
            "globalThis._forgeTestBridge.invokeForgeAction(%s, %s, %s)"
            % (action_json, focus_hint_js, also_activate_js)
        )
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
        self._ensure_bridge()
        return self.eval(
            "globalThis._forgeTestBridge.moveWindowToWorkspace(%d)" % int(ws_index)
        )

    def get_window_count(self) -> int:
        """
        Get the number of tiled windows on the current workspace.

        Returns:
            Number of tiled windows.
        """
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.getWindowCount()")
        try:
            return int(result)
        except (ValueError, TypeError):
            # forge-t3bb: a non-numeric result is the bridge's error sentinel
            # (ERR_NO_ROOT = extension dead/disabled). Coercing it to 0 made
            # "extension dead" indistinguishable from "0 windows".
            raise RuntimeError(f"getWindowCount failed (extension dead?): {result!r}")

    # === Workspace Query Methods ===

    def get_active_workspace_index(self) -> int:
        """
        Get the index of the active workspace.

        Returns:
            Zero-based workspace index.
        """
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.getActiveWorkspaceIndex()")
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
        self._ensure_bridge()
        result = self.eval("globalThis._forgeTestBridge.getWorkspaceCount()")
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
        self._ensure_bridge()
        result = self.eval(
            "globalThis._forgeTestBridge.isWorkspaceTilingSkipped(%d)" % int(ws_index)
        )
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
        self._ensure_bridge()
        return self.eval(
            "globalThis._forgeTestBridge.getNodeForWindow(%s)" % json.dumps(wm_class)
        )

    def get_parent_layout(self, wm_class: str) -> str:
        """
        Get the layout type of a window's parent container.

        Args:
            wm_class: The WM_CLASS of the window.

        Returns:
            Layout type string: 'HSPLIT', 'VSPLIT', 'STACKED', 'TABBED', or 'ERROR'.
        """
        self._ensure_bridge()
        return self.eval(
            "globalThis._forgeTestBridge.getParentLayout(%s)" % json.dumps(wm_class)
        )

    def get_sibling_count(self, wm_class: str) -> int:
        """
        Get the number of siblings (including self) in the same container.

        Args:
            wm_class: The WM_CLASS of the window.

        Returns:
            Number of siblings in the same parent container.
        """
        self._ensure_bridge()
        result = self.eval(
            "globalThis._forgeTestBridge.getSiblingCount(%s)" % json.dumps(wm_class)
        )
        try:
            return int(result)
        except (ValueError, TypeError):
            # forge-t3bb: ERR_NO_ROOT (extension dead) must not read as 0 siblings.
            raise RuntimeError(f"getSiblingCount failed (extension dead?): {result!r}")

    def get_tree_structure(self) -> dict:
        """
        Get a simplified tree structure for assertions.

        Returns:
            Dictionary with nested structure showing nodeType, layout,
            and children for each node in the tree.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.getTreeStructure()")

    def get_focused_node_path(self) -> list:
        """
        Get the path from root to the focused window node.

        Returns:
            List of node types/layouts from root to focused window.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.getFocusedNodePath()")

    def activate_last_sibling_of(self, layout: str) -> dict:
        """Activate the last window-child of the first >=2-child container with `layout`.

        Pins focus onto a deterministic in-container sibling so a subsequent focus-nav
        toward the previous sibling (focus_up in STACKED, focus_left in TABBED) is
        guaranteed to move — independent of which window Mutter happened to focus after a
        mid-test launch, which varies by GNOME version (forge-fjs).

        Returns:
            ``{"id": <int>}`` for the activated window, or ``{"error": <str>}``.
        """
        self._ensure_bridge()
        return self.eval(f'globalThis._forgeTestBridge.activateLastSiblingOf("{layout}")')

    def get_window_siblings(self, wm_class: str) -> list:
        """
        Get information about all siblings in the same container as a window.

        Args:
            wm_class: The WM_CLASS of the window.

        Returns:
            List of sibling info with nodeType, wmClass, and rect.
        """
        self._ensure_bridge()
        return self.eval(
            "globalThis._forgeTestBridge.getWindowSiblings(%s)" % json.dumps(wm_class)
        )

    def verify_tree_integrity(self) -> dict:
        """
        Verify the tree structure is valid (no orphans, proper parent refs).

        Returns:
            Dictionary with 'valid' bool and any 'errors' list.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.verifyTreeIntegrity()")

    # === Fuzzer support (forge-cnrc) ===
    def fuzz_render_now(self) -> str:
        """Force a synchronous tree.render() so reads see the settled, post-cleanTree tree.

        command()/renderTree() only queue an idle render and return before it fires;
        without this the oracle races the pre-cleanup tree. See bridge.fuzzRenderNow.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.fuzzRenderNow()")

    def fuzz_check_invariants(
        self, gap: int = 0, tol: int = 2, render: bool = True
    ) -> dict:
        """Run the deep fuzzer oracle and return {'valid': bool, 'violations': [...]}.

        Each violation is {'rule', 'detail', 'path'}. Only sound invariants are
        checked (see bridge.fuzzCheckInvariants for the rules that were rejected and
        why). Geometry overlap is gap-aware: pass the configured window gap so a
        legitimate inter-window gap is not read as overlap.

        Args:
            gap: Configured window gap in px (overlap must exceed gap + tol to flag).
            tol: Extra slack on overlap in px.
            render: When True, force a synchronous render before checking.
        """
        self._ensure_bridge()
        opts = json.dumps({"gap": int(gap), "tol": int(tol), "render": bool(render)})
        return self.eval(
            "globalThis._forgeTestBridge.fuzzCheckInvariants(%s)" % opts
        )

    def fuzz_pending_work(self) -> dict:
        """Report the fuzzer's async-finalizer backpressure: {'busy', 'queue', 'pendingRender'}.

        Mirrors fuzz_render_now/fuzz_check_invariants. The bridge contract guarantees this
        never throws and always returns a dict, so the engine can POLL it to wait for the
        Move/SnapLayoutMove (~220ms event-queue) and resize (grab-signal) finalizers to
        drain before the oracle reads (M3). See bridge.fuzzPendingWork.
        """
        self._ensure_bridge()
        return self.eval("globalThis._forgeTestBridge.fuzzPendingWork()")

    def fuzz_window_state(self, op: str, focus_window: str = None) -> dict:
        """Apply a Meta.Window state op (minimize/unminimize/fullscreen/unfullscreen) to a
        positionally-selected window, for the fuzzer's window-state class. See
        bridge.fuzzWindowState. Returns {'ok': bool, ...}.
        """
        self._ensure_bridge()
        opts = json.dumps({"op": op, "focus": focus_window})
        return self.eval("globalThis._forgeTestBridge.fuzzWindowState(%s)" % opts)

    def fuzz_drag(self, src: str = None, tgt: str = None, zone: str = "center") -> dict:
        """Simulate a drag-drop tile: drag the SRC window onto ZONE of the TGT window,
        exercising Forge's drop/reparent logic (the only path keybindings can't reach).
        src/tgt are positional hints (leftmost/...). See bridge.fuzzDrag. Returns {'ok',...}.
        """
        self._ensure_bridge()
        opts = json.dumps({"src": src, "tgt": tgt, "zone": zone})
        return self.eval("globalThis._forgeTestBridge.fuzzDrag(%s)" % opts)

    def set_window_gap(self, size: int) -> bool:
        """Reset Forge's window gap (GSettings window-gap-size) to an absolute value.

        Teardown helper for the fuzzer: the GapSize chaos action drifts the persisted gap,
        which would skew the gap-aware overlap oracle in later sessions. Writes through the
        live extension's settings object (bare `Main` is an Eval-global; imports.ui.main is
        not loadable in the Eval scope) so the 'changed' handler re-renders. Returns True on
        success, False if the extension/settings are unavailable.
        """
        self._ensure_bridge()
        js = (
            "(function(){const f=Main.extensionManager.lookup(%s);"
            "if(!f||!f.stateObj||!f.stateObj.settings)return 'no-ext';"
            "f.stateObj.settings.set_uint('window-gap-size', %d);return 'ok';})()"
            % (json.dumps(self.FORGE_UUID), int(size))
        )
        return self.eval(js) == "ok"

    def set_workspace_skip_tile(self, value: str = "") -> bool:
        """Reset Forge's `workspace-skip-tile` GSetting (which workspaces are floated).

        Teardown helper for the fuzzer: WorkspaceActiveTileToggle persists which workspaces
        are floated; left set, a later session/replay starts with a floated workspace and
        diverges. Default "" un-floats all. Mirrors set_window_gap (writes through the live
        extension's settings so the 'changed' handler re-renders). Returns True on success.
        """
        self._ensure_bridge()
        js = (
            "(function(){const f=Main.extensionManager.lookup(%s);"
            "if(!f||!f.stateObj||!f.stateObj.settings)return 'no-ext';"
            "f.stateObj.settings.set_string('workspace-skip-tile', %s);return 'ok';})()"
            % (json.dumps(self.FORGE_UUID), json.dumps(value))
        )
        return self.eval(js) == "ok"

    def set_showtab_decoration(self, enabled: bool = True) -> bool:
        """Reset Forge's `showtab-decoration-enabled` GSetting (schema default True).

        Teardown helper: ShowTabDecorationToggle flips this; left off, later sessions run with
        tab decorations suppressed, hiding the very decoration-lifecycle paths the fuzzer wants
        to exercise. Mirrors set_window_gap. Returns True on success.
        """
        self._ensure_bridge()
        js = (
            "(function(){const f=Main.extensionManager.lookup(%s);"
            "if(!f||!f.stateObj||!f.stateObj.settings)return 'no-ext';"
            "f.stateObj.settings.set_boolean('showtab-decoration-enabled', %s);return 'ok';})()"
            % (json.dumps(self.FORGE_UUID), "true" if enabled else "false")
        )
        return self.eval(js) == "ok"

    def set_tiling_mode(self, enabled: bool = True) -> bool:
        """Reset Forge's `tiling-mode-enabled` GSetting (schema default True).

        Teardown helper: TilingModeToggle flips this and float/unfloats ALL windows; left off,
        later sessions run with tiling globally disabled (everything floats), hiding the tiling
        paths the fuzzer targets. Mirrors set_window_gap. Returns True on success.
        """
        self._ensure_bridge()
        js = (
            "(function(){const f=Main.extensionManager.lookup(%s);"
            "if(!f||!f.stateObj||!f.stateObj.settings)return 'no-ext';"
            "f.stateObj.settings.set_boolean('tiling-mode-enabled', %s);return 'ok';})()"
            % (json.dumps(self.FORGE_UUID), "true" if enabled else "false")
        )
        return self.eval(js) == "ok"

    def activate_workspace(self, ws_index: int) -> dict:
        """Switch the active workspace to ws_index (creating it if needed).

        Distinct from move_window_to_workspace (which relocates the focused window);
        this only changes which workspace is active, for the fuzzer's chaos actions.
        """
        self._ensure_bridge()
        return self.eval(
            "globalThis._forgeTestBridge.activateWorkspace(%d)" % int(ws_index)
        )

    # === Virtual Input Methods (Clutter) ===
    # These use Clutter's VirtualInputDevice API via Shell.Eval to simulate
    # keyboard and mouse input. Unlike xdotool, this works in both X11 and
    # Wayland modes because it goes through Clutter's input pipeline directly.
    #
    # Virtual devices are created once and cached in globalThis._forgeTest*
    # to avoid resource exhaustion from creating devices per key press.

    def _ensure_virtual_devices(self) -> None:
        """Ensure the cached Clutter virtual devices exist (forge-9q3).

        Device creation lives in the bridge (ensureVirtualDevices); this just guarantees the
        bridge is installed, then calls it. The bridge method is idempotent (globalThis guard),
        so there is no separate Python flag to go stale on reconnect — the single
        _bridge_installed flag (reset in disconnect) is what re-arms devices after a shell
        restart. The per-press notify_* sequences below still build their own JS.
        """
        self._ensure_bridge()
        self.eval("globalThis._forgeTestBridge.ensureVirtualDevices()")

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
    # frames are self-identifying for failure diagnostics. The St.Label creation +
    # render lives in the bridge (renderOverlay, forge-9q3) — cached on
    # globalThis._forgeTestOverlay so it survives across evals, parented to uiGroup
    # (NOT addChrome, which would register struts and perturb tiling geometry).
    # These Python methods own only the text composition. Only driven when
    # FORGE_E2E_RECORD=1 (see conftest / input_simulator); a no-op on normal lanes.

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
        self._ensure_bridge()
        self.eval(f"globalThis._forgeTestBridge.renderOverlay({json.dumps(text)})")

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
        self._ensure_bridge()
        return self.eval(
            "globalThis._forgeTestBridge.getContainerChildrenCount(%s)" % json.dumps(wm_class)
        )
