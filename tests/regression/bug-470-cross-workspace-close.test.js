import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";
import { WindowType } from "../mocks/gnome/Meta.js";

/**
 * Bug #470 (forge-6qr): closing a window disrupts tiling / focus across workspaces.
 *
 * windowDestroy() detaches the closed node (removeNode nulls parentNode) BEFORE
 * _restoreFocusAfterWindowClosed runs, and that method bailed on a null parentNode.
 * So in the common multi-sibling case focus restoration silently no-opped, and the
 * lone-window fallback used the *globally active* workspace — pulling focus to (and
 * disturbing) a different workspace than the one the window closed on.
 *
 * Fix: snapshot the restoration context (siblings + the closed window's workspace
 * node) from the still-intact tree before removeNode, then restore scoped to that
 * workspace.
 *
 * Note: the prior bug-258 test was vacuous (array filtering on hand-built trees);
 * the residual Mutter super+c tile-snap contamination (forge-3xz) is e2e-only.
 */
describe("Bug #470: focus restoration on close stays on the closed window's workspace", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true },
      globals: { workspaceManager: { workspaceCount: 2 } },
    });
    // Keep the test focused on focus restoration, not rendering side effects.
    vi.spyOn(ctx.windowManager, "renderTree").mockImplementation(() => {});
    vi.spyOn(ctx.windowManager, "queueEvent").mockImplementation(() => {});
    vi.spyOn(ctx.windowManager, "removeFloatOverride").mockImplementation(() => {});
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const wm = () => ctx.windowManager;

  function closeFocused(nodeWindow) {
    const actor = nodeWindow.nodeValue.get_compositor_private();
    vi.spyOn(ctx.tree, "findNodeByActor").mockReturnValue(nodeWindow);
    ctx.display.get_focus_window.mockReturnValue(nodeWindow.nodeValue);
    wm().windowDestroy(actor);
  }

  it("restores focus to a sibling when the focused window is closed", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0);
    const wWin = createMockWindow({ id: "W", title: "W" });
    const vWin = createMockWindow({ id: "V", title: "V" });
    const nodeW = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, wWin);
    nodeW.mode = WINDOW_MODES.TILE;
    const nodeV = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, vWin);
    nodeV.mode = WINDOW_MODES.TILE;

    const activateV = vi.spyOn(vWin, "activate");

    closeFocused(nodeW);

    expect(activateV).toHaveBeenCalled();
  });

  it("falls back to a window on the closed window's workspace, not the active one", () => {
    // WS0: monitor -> [ con[W] , U ]  (W has no in-container sibling)
    const { monitor: mon0 } = getWorkspaceAndMonitor(ctx, 0);
    const conW = ctx.tree.createNode(mon0.nodeValue, NODE_TYPES.CON, new Bin());
    const wWin = createMockWindow({ id: "W", title: "W" });
    const nodeW = ctx.tree.createNode(conW.nodeValue, NODE_TYPES.WINDOW, wWin);
    nodeW.mode = WINDOW_MODES.TILE;
    const uWin = createMockWindow({ id: "U", title: "U" });
    const nodeU = ctx.tree.createNode(mon0.nodeValue, NODE_TYPES.WINDOW, uWin);
    nodeU.mode = WINDOW_MODES.TILE;

    // WS1 (active): a window X that must NOT be focused when WS0's window closes.
    const { monitor: mon1 } = getWorkspaceAndMonitor(ctx, 1);
    const xWin = createMockWindow({ id: "X", title: "X" });
    const nodeX = ctx.tree.createNode(mon1.nodeValue, NODE_TYPES.WINDOW, xWin);
    nodeX.mode = WINDOW_MODES.TILE;

    ctx.workspaceManager.get_active_workspace = vi.fn(() => ctx.workspaces[1]);

    const activateU = vi.spyOn(uWin, "activate");
    const activateX = vi.spyOn(xWin, "activate");

    closeFocused(nodeW);

    expect(activateU).toHaveBeenCalled();
    expect(activateX).not.toHaveBeenCalled();
  });

  it("does not hand focus to a transient dialog when no NORMAL window remains", () => {
    // WS0: monitor -> [ con[W] , D(dialog) ]  — W has no sibling; only a dialog remains.
    const { monitor } = getWorkspaceAndMonitor(ctx, 0);
    const conW = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    const wWin = createMockWindow({ id: "W", title: "W" });
    const nodeW = ctx.tree.createNode(conW.nodeValue, NODE_TYPES.WINDOW, wWin);
    nodeW.mode = WINDOW_MODES.TILE;
    const dWin = createMockWindow({ id: "D", title: "D", window_type: WindowType.MODAL_DIALOG });
    const nodeD = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dWin);
    nodeD.mode = WINDOW_MODES.TILE;

    const activateD = vi.spyOn(dWin, "activate");

    closeFocused(nodeW);

    expect(activateD).not.toHaveBeenCalled();
  });
});
