import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * A tiled window re-homed onto a workspace kept the percent it had where it came
 * from. Next to windows whose percents already summed to 1 it got no room of its
 * own; it now gets a fair share of the destination. A whole layout migrating
 * together (forge-6pe) still keeps its proportions.
 */
describe("Re-homing a window gives it a share of the destination", () => {
  let ctx, tree, wm;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 0 } },
    });
    tree = ctx.tree;
    wm = ctx.windowManager;
    vi.spyOn(wm, "renderTree").mockImplementation(() => {});
    vi.spyOn(wm, "trackCurrentMonWs").mockImplementation(() => {});
    for (let i = 0; i < 2; i++) {
      const { monitor } = getWorkspaceAndMonitor(ctx, i, 0);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1200, height: 800 };
    }
  });

  afterEach(() => ctx.cleanup());

  function addWindow(id, wsIndex, percent) {
    const { monitor } = getWorkspaceAndMonitor(ctx, wsIndex, 0);
    const win = createMockWindow({ id });
    win._workspace = ctx.workspaces[wsIndex];
    win._monitor = 0;
    const node = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    node.percent = percent;
    return { win, node };
  }

  it("carves an equal share next to windows that fill the workspace", () => {
    const { node: a } = addWindow("A", 0, 0.5);
    const { node: c } = addWindow("C", 0, 0.5);
    const { win: winB, node: b } = addWindow("B", 1, 0);

    winB._workspace = ctx.workspaces[0];
    wm._reconcileWindowHomes();

    expect(b.parentNode).toBe(a.parentNode);
    [a, c, b].forEach((n) => expect(n.percent).toBeCloseTo(1 / 3, 5));
  });

  it("keeps an equal split equal", () => {
    const { node: a } = addWindow("A", 0, 0);
    const { node: c } = addWindow("C", 0, 0);
    const { win: winB, node: b } = addWindow("B", 1, 0.5);

    winB._workspace = ctx.workspaces[0];
    wm._reconcileWindowHomes();

    expect([a.percent, c.percent, b.percent]).toEqual([0, 0, 0]);
  });
});
