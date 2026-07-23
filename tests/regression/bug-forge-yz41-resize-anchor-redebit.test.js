import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createContainerNode,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";
import { Rectangle, GrabOp, MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-yz41 (audit-2026-07 / C8): the forge-12f (#305) start-of-grab snapshot
 * that anchors the resize pair on its grab-begin rect was applied ONLY to the
 * same-parent branch of _handleResizing. The container branch
 * (_resizeContainerAgainstSibling) and the cross-parent branch still anchor the
 * pair (and the container start slice) on LIVE node rects. On X11 a single
 * move_resize_frame emits several size-changed events, each re-rendering the node
 * rects, so the cumulative changePx is re-debited against an already-debited live
 * rect and the shared edge drifts past the pointer.
 *
 * Fix: snapshot those rects via _pairInitRect too, so changePx is always measured
 * against the grab-begin geometry.
 */
describe("Bug forge-yz41: container/cross-parent resize anchors on grab-begin snapshot", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp, MotionDirection };
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  // monitor HSPLIT 900 wide: [ TABBED container(0.5) | WinC(0.5) ].
  function buildTabbedNextToWindow() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

    const container = new Node(NODE_TYPES.CON, new Bin());
    container.settings = ctx.tree.settings;
    container.layout = LAYOUT_TYPES.TABBED;
    container.percent = 0.5;
    container.rect = { x: 0, y: 0, width: 450, height: 600 };
    monitor.appendChild(container);

    const winA = createMockWindow({ id: 5001, title: "A", allows_resize: true });
    const nodeA = new Node(NODE_TYPES.WINDOW, winA);
    const nodeB = new Node(NODE_TYPES.WINDOW, createMockWindow({ id: 5002, title: "B" }));
    nodeA.settings = ctx.tree.settings;
    nodeB.settings = ctx.tree.settings;
    nodeA.mode = WINDOW_MODES.TILE;
    nodeB.mode = WINDOW_MODES.TILE;
    nodeA.rect = { x: 0, y: 0, width: 450, height: 600 };
    nodeB.rect = { x: 0, y: 0, width: 450, height: 600 };
    container.appendChild(nodeA);
    container.appendChild(nodeB);

    const winC = createMockWindow({
      id: 5003,
      title: "C",
      allows_resize: true,
      rect: new Rectangle({ x: 450, y: 0, width: 450, height: 600 }),
    });
    const nodeC = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, winC);
    nodeC.mode = WINDOW_MODES.TILE;
    nodeC.percent = 0.5;
    nodeC.rect = { x: 450, y: 0, width: 450, height: 600 };

    return { container, nodeA, winA, nodeC };
  }

  function dragRight(nodeA, winA, growBy) {
    nodeA.initRect = { x: 0, y: 0, width: 450, height: 600 };
    nodeA.initGrabOp = GrabOp.RESIZING_E;
    ctx.windowManager.grabOp = GrabOp.RESIZING_E;
    winA.get_frame_rect = () => new Rectangle({ x: 0, y: 0, width: 450 + growBy, height: 600 });
    ctx.display.get_focus_window.mockReturnValue(winA);
    ctx.windowManager._handleResizing(nodeA);
  }

  it("repeated size-changed passes do not re-debit the live pair rect (container branch)", () => {
    const v = buildTabbedNextToWindow();

    // Pass 1: partial resize (+30). Container -> ~0.533, WinC -> ~0.467.
    dragRight(v.nodeA, v.winA, 30);
    // Between events the render pipeline applies the new percents to node rects.
    v.container.rect = { ...v.container.rect, width: v.container.percent * 900 };
    v.nodeC.rect = { ...v.nodeC.rect, width: v.nodeC.percent * 900 };
    // Pass 2: resize finishes (+90 cumulative against the same grab-begin anchor).
    dragRight(v.nodeA, v.winA, 90);

    // Correct result is 540/360 (0.6/0.4). Without the snapshot, pass 2 re-debits
    // the already-grown live rects and the container overshoots (~0.633).
    expect(v.container.percent).toBeCloseTo(0.6, 5);
    expect(v.nodeC.percent).toBeCloseTo(0.4, 5);
    expect(v.container.percent + v.nodeC.percent).toBeCloseTo(1.0, 5);
  });
});
