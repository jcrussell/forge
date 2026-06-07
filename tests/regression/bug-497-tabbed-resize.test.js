import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";
import { Rectangle, GrabOp } from "../mocks/gnome/Meta.js";

/**
 * forge-pak (#497): resizing a window inside a TABBED/STACKED container did
 * nothing — the tabs all share the container's rect, so a tab is never a
 * meaningful resize pair. The boundary "snapped back" because the container's
 * own percent (against its split siblings) was never updated.
 *
 * Layout: monitor HSPLIT, 900 wide:
 *   [ Container(0.5)  |  WinC(0.5) ]
 *   Container = TABBED/STACKED holding WinA, WinB (both fill the container).
 *
 * Resizing WinA toward WinC must grow the CONTAINER's percent and shrink WinC's,
 * and that must persist (be applied to the container node, not an overlapping
 * tab whose percent the render ignores).
 */
describe("Bug #497: tabbed/stacked container resizes against its sibling", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  function buildTabbedNextToWindow(layout) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

    // Tabbed/stacked container on the left (half the row).
    const container = new Node(NODE_TYPES.CON, new Bin());
    container.settings = ctx.tree.settings;
    container.layout = layout;
    container.percent = 0.5;
    container.rect = { x: 0, y: 0, width: 450, height: 600 };
    monitor.appendChild(container);

    // Two tabs that both fill the container rect.
    const winA = createMockWindow({ id: 4001, title: "A", allows_resize: true });
    const winB = createMockWindow({ id: 4002, title: "B", allows_resize: true });
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

    // Normal tiled window on the right (the resize partner).
    const winC = createMockWindow({
      id: 4003,
      title: "C",
      allows_resize: true,
      rect: new Rectangle({ x: 450, y: 0, width: 450, height: 600 }),
    });
    const nodeC = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, winC);
    nodeC.mode = WINDOW_MODES.TILE;
    nodeC.percent = 0.5;
    nodeC.rect = { x: 450, y: 0, width: 450, height: 600 };

    return { container, nodeA, nodeB, nodeC, winA };
  }

  // Drag WinA's right edge so its frame grows by `growBy` px.
  function dragRight(nodeA, winA, growBy) {
    nodeA.initRect = { x: 0, y: 0, width: 450, height: 600 };
    nodeA.initGrabOp = GrabOp.RESIZING_E;
    ctx.windowManager.grabOp = GrabOp.RESIZING_E;
    winA.get_frame_rect = () => new Rectangle({ x: 0, y: 0, width: 450 + growBy, height: 600 });
    ctx.display.get_focus_window.mockReturnValue(winA);
    ctx.windowManager._handleResizing(nodeA);
  }

  it("grows the TABBED container's percent and shrinks the sibling", () => {
    const v = buildTabbedNextToWindow(LAYOUT_TYPES.TABBED);
    dragRight(v.nodeA, v.winA, 90);

    // Container grew (0.5 -> 0.6), WinC shrank (0.5 -> 0.4).
    expect(v.container.percent).toBeCloseTo(0.6, 5);
    expect(v.nodeC.percent).toBeCloseTo(0.4, 5);
    expect(v.container.percent + v.nodeC.percent).toBeCloseTo(1.0, 5);
  });

  it("grows the STACKED container's percent and shrinks the sibling", () => {
    const v = buildTabbedNextToWindow(LAYOUT_TYPES.STACKED);
    dragRight(v.nodeA, v.winA, 90);

    expect(v.container.percent).toBeCloseTo(0.6, 5);
    expect(v.nodeC.percent).toBeCloseTo(0.4, 5);
  });

  it("the grown percent is honored by the layout pass (does not snap back)", () => {
    const v = buildTabbedNextToWindow(LAYOUT_TYPES.TABBED);
    dragRight(v.nodeA, v.winA, 90);

    // Re-run the layout pass: the container's slice must reflect ~0.6 of the
    // row, i.e. it grew and stayed grown rather than snapping back to an even
    // split. (processNode lays out against the real monitor width.)
    ctx.tree.processNode(ctx.tree);

    expect(v.container.percent).toBeGreaterThan(0.5);
    const row = v.container.rect.width + v.nodeC.rect.width;
    expect(v.container.rect.width).toBeGreaterThan(v.nodeC.rect.width);
    expect(v.container.rect.width / row).toBeCloseTo(0.6, 2);
  });
});
