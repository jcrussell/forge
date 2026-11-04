import { describe, it, expect, afterEach, vi } from "vitest";
import { LAYOUT_TYPES, NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createContainerNode,
  createWindowManagerFixture,
  createWindowNode,
} from "../../mocks/helpers/index.js";

/**
 * Under workspaces-only-on-primary, windows on a non-primary monitor are sticky:
 * get_workspace() reports the active workspace, and no per-window
 * workspace-changed fires on a switch. Forge moves them to mo{m}ws{active} on
 * every switch, where directional focus/move look for them.
 */
describe("WindowManager - sticky windows follow the active workspace", () => {
  let ctx;
  const wm = () => ctx.windowManager;
  const mon = (m, ws) => ctx.tree.findNode(`mo${m}ws${ws}`);
  const windowsOf = (node) => node.getNodeByType(NODE_TYPES.WINDOW).map((n) => n.nodeValue);

  // Monitor 1 is primary; monitor 0 is the sticky one.
  const setup = ({ activeWs = 0 } = {}) => {
    ctx = createWindowManagerFixture({
      globals: {
        display: { monitorCount: 2 },
        workspaceManager: { workspaceCount: 3, activeWorkspaceIndex: activeWs },
      },
    });
    ctx.display.get_primary_monitor = vi.fn(() => 1);
  };

  const activate = (ws) => {
    ctx.workspaceManager.get_active_workspace_index.mockReturnValue(ws);
    ctx.workspaceManager.get_active_workspace.mockReturnValue(
      ctx.workspaceManager.get_workspace_by_index(ws)
    );
  };

  const addCon = (parent, layout = LAYOUT_TYPES.HSPLIT) => createContainerNode(parent, layout);
  const addWindow = (parent, id, { sticky = true, monitor = 0, ws = null } = {}) =>
    createWindowNode(ctx.tree, parent, {
      windowOverrides: {
        id,
        monitor,
        on_all_workspaces: sticky,
        workspace: ws === null ? null : ctx.workspaceManager.get_workspace_by_index(ws),
      },
    }).metaWindow;

  afterEach(() => ctx?.cleanup());

  it("carries the whole sticky monitor to the active workspace, layout and shares intact", () => {
    setup();
    const stray = mon(0, 2);
    stray.layout = LAYOUT_TYPES.VSPLIT;
    const top = addCon(stray);
    const bottom = addCon(stray);
    top.percent = 0.7;
    bottom.percent = 0.3;
    const a = addWindow(top, 1);
    const b = addWindow(bottom, 2);

    wm()._rehomeStickyWindows();

    const target = mon(0, 0);
    expect(windowsOf(target)).toEqual([a, b]);
    expect(target.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(target.childNodes).toEqual([top, bottom]);
    expect([top.percent, bottom.percent]).toEqual([0.7, 0.3]);
    expect(stray.childNodes).toHaveLength(0);
  });

  it("carries a tabbed monitor with the split it restores to", () => {
    setup();
    const stray = mon(0, 2);
    stray.layout = LAYOUT_TYPES.VSPLIT;
    stray.layout = LAYOUT_TYPES.TABBED; // remembers VSPLIT as its splitLayout
    addWindow(stray, 1);

    wm()._rehomeStickyWindows();

    const target = mon(0, 0);
    expect(target.layout).toBe(LAYOUT_TYPES.TABBED);
    expect(target.splitLayout).toBe(LAYOUT_TYPES.VSPLIT);
  });

  it("joins windows already on the target and keeps the target's layout", () => {
    setup();
    const target = mon(0, 0);
    target.layout = LAYOUT_TYPES.HSPLIT;
    const kept = addWindow(target, 1);
    target.childNodes[0].percent = 1.0;
    const stray = mon(0, 2);
    stray.layout = LAYOUT_TYPES.VSPLIT;
    const moved = addWindow(stray, 2);
    stray.childNodes[0].percent = 1.0;

    wm()._rehomeStickyWindows();

    expect(windowsOf(target)).toEqual([kept, moved]);
    expect(target.layout).toBe(LAYOUT_TYPES.HSPLIT);
    // The arrival gets a fair share of the target, not the share it had of the source.
    expect(target.childNodes.map((n) => n.percent)).toEqual([0.5, 0.5]);
    expect(stray.childNodes).toHaveLength(0);
  });

  it("leaves a moving window that is not sticky to the idle reconcile", () => {
    setup();
    // Mid-burst (GNOME inserting a workspace): the live workspace already says 1,
    // the tree still says 2. Re-homing it eagerly would flatten its container.
    const own = addWindow(mon(1, 2), 1, { sticky: false, monitor: 1, ws: 1 });

    wm()._rehomeStickyWindows();

    expect(windowsOf(mon(1, 2))).toEqual([own]);
    expect(windowsOf(mon(1, 1))).toEqual([]);
  });

  it("waits while a workspace removal has renumbered Mutter but not the tree", () => {
    setup();
    const own = addWindow(mon(0, 2), 1);
    ctx.workspaceManager.get_n_workspaces.mockReturnValue(2);

    wm()._rehomeStickyWindows();

    expect(windowsOf(mon(0, 2))).toEqual([own]);
  });

  it("re-homes once a workspace appended and activated reaches the tree", () => {
    setup();
    const sticky = addWindow(mon(0, 0), 1);
    vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    ctx.settings.connect ??= vi.fn(() => 1);
    wm()._bindSignals();

    // Mutter appends ws3 and activates it before emitting workspace-added.
    ctx.workspaceManager.get_n_workspaces.mockReturnValue(4);
    activate(3);
    ctx.workspaceManager.emit("active-workspace-changed");
    expect(windowsOf(mon(0, 0))).toEqual([sticky]);

    // The mock emit does not prepend the emitter, as GObject does.
    ctx.workspaceManager.emit("workspace-added", ctx.workspaceManager, 3);

    expect(windowsOf(mon(0, 3))).toEqual([sticky]);
  });

  it("re-homes on active-workspace-changed", () => {
    setup();
    const sticky = addWindow(mon(0, 0), 1);
    vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    // _bindSignals wires every source at once; only the workspace manager's
    // handlers matter here, so give the other sources an inert connect().
    ctx.settings.connect ??= vi.fn(() => 1);
    wm()._bindSignals();

    activate(1);
    ctx.workspaceManager.emit("active-workspace-changed");

    expect(windowsOf(mon(0, 1))).toEqual([sticky]);
    expect(windowsOf(mon(0, 0))).toEqual([]);
  });
});
