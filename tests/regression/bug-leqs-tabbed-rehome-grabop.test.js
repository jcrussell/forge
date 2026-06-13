import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { GrabOp } from "../mocks/gnome/Meta.js";

/**
 * forge-leqs: two related grab-op defects in window.js.
 *
 * (1) updateMetaWorkspaceMonitor guarded the tabbed-focus update with
 *     `if (!this.grabOp === Meta.GrabOp.WINDOW_BASE)`. `!` binds tighter than
 *     `===`, so this parsed as `(!this.grabOp) === WINDOW_BASE` — a boolean
 *     compared to a numeric enum, ALWAYS false. updateTabbedFocus was therefore
 *     dead on the re-home path, so a tabbed tab sent to another monitor/workspace
 *     was never raised on its destination. Fixed to `this.grabOp !== WINDOW_BASE`.
 *
 * (2) this.grabOp was assigned in _handleGrabOpBegin but never cleared, so after
 *     the user's first window-decoration drag it stayed === WINDOW_BASE forever,
 *     re-killing the (now correct) guard. _handleGrabOpEnd now clears it.
 */
describe("forge-leqs: tabbed re-home tabbed-focus guard + grabOp clearing", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: {
        workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 0 },
      },
    });
    // window.js reads Meta.GrabOp from the global Meta namespace.
    global.Meta = { ...(global.Meta || {}), GrabOp };
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  // A tiled window node on monitor 0 / workspace 0 whose metaWindow now reports
  // workspace 1 — i.e. it was sent to another workspace and must be re-homed.
  function setupRehomeScenario() {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const metaWindow = createMockWindow({ id: "tab-1", workspace: ctx.workspaces[0] });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    // Mutter now reports the destination workspace for this window.
    metaWindow._workspace = ctx.workspaces[1];
    metaWindow._monitor = 0;
    return { metaWindow, node };
  }

  it("calls updateTabbedFocus on re-home when no WINDOW_BASE grab is active (precedence fix)", () => {
    const { metaWindow } = setupRehomeScenario();
    wm().grabOp = null; // no drag in progress
    const tabbedSpy = vi.spyOn(wm(), "updateTabbedFocus");

    wm().updateMetaWorkspaceMonitor("test", 0, metaWindow);

    expect(tabbedSpy).toHaveBeenCalled();
  });

  it("suppresses updateTabbedFocus while a WINDOW_BASE drag is in progress", () => {
    const { metaWindow } = setupRehomeScenario();
    wm().grabOp = GrabOp.WINDOW_BASE; // user is drag-moving by the decoration
    const tabbedSpy = vi.spyOn(wm(), "updateTabbedFocus");

    wm().updateMetaWorkspaceMonitor("test", 0, metaWindow);

    expect(tabbedSpy).not.toHaveBeenCalled();
  });

  it("clears grabOp at grab-end so a later re-home is not poisoned by a stale op", () => {
    const metaWindow = createMockWindow({ id: "dragged", workspace: ctx.workspaces[0] });
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    ctx.display.get_focus_window.mockReturnValue(metaWindow);
    // Isolate from forge-3jx9: the grab-end drop path consults the keybindings,
    // which are null in the fixture. The grabOp clearing is what we assert here.
    vi.spyOn(wm(), "allowDragDropTile").mockReturnValue(false);

    wm()._handleGrabOpBegin(ctx.display, metaWindow, GrabOp.WINDOW_BASE);
    expect(wm().grabOp).toBe(GrabOp.WINDOW_BASE);

    wm()._handleGrabOpEnd(ctx.display, metaWindow, GrabOp.WINDOW_BASE);
    expect(wm().grabOp).toBeNull();
  });
});
