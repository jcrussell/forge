import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Meta from "gi://Meta";
import { LAYOUT_TYPES, NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createContainerNode,
  createWindowManagerFixture,
  createWindowNode,
} from "../../mocks/helpers/index.js";

/**
 * Under workspaces-only-on-primary, windows on a non-primary monitor follow the
 * active workspace, but Mutter emits no per-window workspace-changed for that. On
 * every active-workspace switch Forge must therefore carry the non-primary
 * monitor's sub-tree to mo{m}ws{active}, or directional focus/move — which resolve
 * that node — find it empty (Super+Left from the primary monitor did nothing).
 */
describe("WindowManager - sticky non-primary monitors", () => {
  let ctx;
  const wm = () => ctx.windowManager;
  const mon = (m, ws) => ctx.tree.findNode(`mo${m}ws${ws}`);
  const windowsOf = (node) => node.getNodeByType(NODE_TYPES.WINDOW).map((n) => n.nodeValue);

  const setup = ({ onlyOnPrimary = true, activeWs = 0 } = {}) => {
    Meta.__setWorkspacesOnlyOnPrimary(onlyOnPrimary);
    ctx = createWindowManagerFixture({
      globals: {
        display: { monitorCount: 2, primaryMonitor: 1 },
        workspaceManager: { workspaceCount: 3, activeWorkspaceIndex: activeWs },
      },
    });
  };

  const addCon = (parent, layout = LAYOUT_TYPES.HSPLIT) => createContainerNode(parent, layout);
  const addWindow = (parent, id) =>
    createWindowNode(ctx.tree, parent, { windowOverrides: { id } }).metaWindow;

  afterEach(() => {
    Meta.__setWorkspacesOnlyOnPrimary(false);
    ctx?.cleanup();
  });

  it("carries the whole non-primary sub-tree to the active workspace, layout intact", () => {
    setup({ activeWs: 0 });
    const stray = mon(0, 2);
    stray.layout = LAYOUT_TYPES.VSPLIT;
    const top = addCon(stray);
    const bottom = addCon(stray);
    top.percent = 0.7;
    bottom.percent = 0.3;
    const a = addWindow(top, 1);
    const b = addWindow(bottom, 2);

    wm()._rehomeStickyMonitors();

    const target = mon(0, 0);
    expect(windowsOf(target)).toEqual([a, b]);
    expect(target.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(target.childNodes).toEqual([top, bottom]);
    expect([top.percent, bottom.percent]).toEqual([0.7, 0.3]);
    expect(stray.childNodes).toHaveLength(0);
  });

  it("merges into a target that already holds windows and keeps its layout", () => {
    setup({ activeWs: 0 });
    const target = mon(0, 0);
    target.layout = LAYOUT_TYPES.HSPLIT;
    const kept = addWindow(target, 1);
    const stray = mon(0, 2);
    stray.layout = LAYOUT_TYPES.VSPLIT;
    const moved = addWindow(stray, 2);
    const redistribute = vi.spyOn(ctx.tree, "redistributeSiblingPercent");

    wm()._rehomeStickyMonitors();

    expect(windowsOf(target)).toEqual([kept, moved]);
    expect(target.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(redistribute).toHaveBeenCalledWith(target);
    expect(stray.childNodes).toHaveLength(0);
  });

  it("leaves the primary monitor's other workspaces alone", () => {
    setup({ activeWs: 0 });
    const own = addWindow(mon(1, 2), 1);

    wm()._rehomeStickyMonitors();

    expect(windowsOf(mon(1, 2))).toEqual([own]);
    expect(windowsOf(mon(1, 0))).toEqual([]);
  });

  it("does nothing when workspaces span all monitors", () => {
    setup({ onlyOnPrimary: false, activeWs: 0 });
    const own = addWindow(mon(0, 2), 1);

    wm()._rehomeStickyMonitors();

    expect(windowsOf(mon(0, 2))).toEqual([own]);
    expect(windowsOf(mon(0, 0))).toEqual([]);
  });

  it("skips a move whose target monitor node does not exist", () => {
    setup({ activeWs: 0 });
    const own = addWindow(mon(0, 2), 1);
    const target = mon(0, 0);
    target.parentNode.removeChild(target);

    expect(() => wm()._rehomeStickyMonitors()).not.toThrow();
    expect(windowsOf(mon(0, 2))).toEqual([own]);
  });

  it("re-homes on active-workspace-changed before rendering", () => {
    setup({ activeWs: 0 });
    const order = [];
    vi.spyOn(wm(), "_rehomeStickyMonitors").mockImplementation(() => order.push("rehome"));
    vi.spyOn(wm(), "renderTree").mockImplementation(() => order.push("render"));
    // _bindSignals wires every source at once; only the workspace manager's
    // handlers matter here, so give the other sources an inert connect().
    ctx.settings.connect ??= vi.fn(() => 1);
    wm()._bindSignals();

    ctx.workspaceManager.emit("active-workspace-changed");

    expect(order).toEqual(["rehome", "render"]);
  });
});
