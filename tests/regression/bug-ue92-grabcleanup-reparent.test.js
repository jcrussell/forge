import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";
import { GrabOp } from "../mocks/gnome/Meta.js";

/**
 * forge-ue92: _grabCleanup cleared the tabbed/stacked ancestor initRect snapshots
 * by re-walking focusNodeWindow.parentNode — the POST-reparent chain.
 *
 * _handleGrabOpEnd reparents the dragged node (moveWindowToPointer) BEFORE
 * _grabCleanup runs, so when a tab is dragged OUT of its container the original
 * container is no longer on the parentNode chain and never gets its stale
 * initRect cleared. The next tab resize inside that container then anchors on the
 * pre-drag rect (container.initRect || container.rect) and jumps, and the jump is
 * baked in by _normalizeSiblingPercents.
 *
 * Fix: record the exact ancestors snapshotted at grab-begin and clear those in
 * cleanup, independent of any reparent.
 */
describe("forge-ue92: _grabCleanup clears the pre-reparent container snapshot", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  function buildTabbedWithTwoTabs() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

    const container = new Node(NODE_TYPES.CON, new Bin());
    container.settings = ctx.tree.settings;
    container.layout = LAYOUT_TYPES.TABBED;
    container.percent = 0.5;
    container.rect = { x: 0, y: 0, width: 450, height: 600 };
    monitor.appendChild(container);

    const winA = createMockWindow({
      id: 4001,
      title: "A",
      allows_resize: true,
      workspace: ctx.workspaces[0],
    });
    const winB = createMockWindow({
      id: 4002,
      title: "B",
      allows_resize: true,
      workspace: ctx.workspaces[0],
    });
    const nodeA = new Node(NODE_TYPES.WINDOW, winA);
    const nodeB = new Node(NODE_TYPES.WINDOW, winB);
    nodeA.settings = ctx.tree.settings;
    nodeB.settings = ctx.tree.settings;
    nodeA.mode = WINDOW_MODES.TILE;
    nodeB.mode = WINDOW_MODES.TILE;
    nodeA.rect = { x: 0, y: 0, width: 450, height: 600 };
    nodeB.rect = { x: 0, y: 0, width: 450, height: 600 };
    container.appendChild(nodeA);
    container.appendChild(nodeB);

    return { monitor, container, nodeA, nodeB, winA };
  }

  it("clears the original container's initRect after a tab is dragged out", () => {
    const { monitor, container, nodeA, winA } = buildTabbedWithTwoTabs();
    ctx.display.get_focus_window.mockReturnValue(winA);

    // Grab begins while nodeA is still inside the tabbed container.
    ctx.windowManager._handleGrabOpBegin(ctx.display, winA, GrabOp.RESIZING_E);
    expect(container.initRect).toBeTruthy(); // container was snapshotted

    // The drag reparents nodeA OUT of the container (what moveWindowToPointer does
    // at grab end, before _grabCleanup runs).
    monitor.appendChild(nodeA);
    expect(nodeA.parentNode).toBe(monitor);

    ctx.windowManager._grabCleanup(nodeA);

    // The now-detached container's stale snapshot must still be cleared.
    expect(container.initRect).toBeNull();
  });

  it("still clears the container snapshot on a plain in-place resize (no regression)", () => {
    const { container, nodeA, winA } = buildTabbedWithTwoTabs();
    ctx.display.get_focus_window.mockReturnValue(winA);

    ctx.windowManager._handleGrabOpBegin(ctx.display, winA, GrabOp.RESIZING_E);
    expect(container.initRect).toBeTruthy();

    // No reparent this time — cleanup on the still-nested node.
    ctx.windowManager._grabCleanup(nodeA);

    expect(container.initRect).toBeNull();
  });
});
