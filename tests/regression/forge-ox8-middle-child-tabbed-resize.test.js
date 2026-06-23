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
 * forge-ox8 (#64): resize a tabbed/stacked container that is a MIDDLE child —
 * i.e. it has split siblings on BOTH sides. This is the scenario #64 asks about,
 * which the #497 fix (forge-pak, _resizeContainerAgainstSibling) should already
 * cover via nextVisible(container, direction): dragging right resizes against the
 * RIGHT neighbor, dragging left resizes against the LEFT neighbor, and the
 * opposite (non-adjacent) sibling must stay untouched.
 *
 * bug-497-tabbed-resize.test.js only covers a container that is the FIRST child
 * with a single right-side sibling, so this test adds the missing middle-child +
 * leftward-resize coverage. If it passes, #64 is confirmed resolved by #497.
 *
 * Layout: monitor HSPLIT, 900 wide, three equal thirds:
 *   [ WinLeft(1/3) | Container(1/3, tabbed: WinA,WinB) | WinRight(1/3) ]
 */
describe("forge-ox8 (#64): resize a MIDDLE-child tabbed container", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    global.Meta = { ...(global.Meta || {}), GrabOp };
  });

  afterEach(() => {
    ctx.cleanup();
    delete global.Meta;
  });

  const THIRD = 1 / 3;

  function buildMiddleTabbed(layout) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 900, height: 600 };

    // Left split sibling (the opposite neighbor for a rightward drag).
    const winL = createMockWindow({ id: 5001, title: "L", allows_resize: true });
    const nodeL = new Node(NODE_TYPES.WINDOW, winL);
    nodeL.settings = ctx.tree.settings;
    nodeL.mode = WINDOW_MODES.TILE;
    nodeL.percent = THIRD;
    nodeL.rect = { x: 0, y: 0, width: 300, height: 600 };
    monitor.appendChild(nodeL);

    // Tabbed/stacked container in the MIDDLE.
    const container = new Node(NODE_TYPES.CON, new Bin());
    container.settings = ctx.tree.settings;
    container.layout = layout;
    container.percent = THIRD;
    container.rect = { x: 300, y: 0, width: 300, height: 600 };
    monitor.appendChild(container);

    const winA = createMockWindow({ id: 5002, title: "A", allows_resize: true });
    const winB = createMockWindow({ id: 5003, title: "B", allows_resize: true });
    const nodeA = new Node(NODE_TYPES.WINDOW, winA);
    const nodeB = new Node(NODE_TYPES.WINDOW, winB);
    nodeA.settings = ctx.tree.settings;
    nodeB.settings = ctx.tree.settings;
    nodeA.mode = WINDOW_MODES.TILE;
    nodeB.mode = WINDOW_MODES.TILE;
    // Both tabs fill the container rect.
    nodeA.rect = { x: 300, y: 0, width: 300, height: 600 };
    nodeB.rect = { x: 300, y: 0, width: 300, height: 600 };
    container.appendChild(nodeA);
    container.appendChild(nodeB);

    // Right split sibling.
    const winR = createMockWindow({ id: 5004, title: "R", allows_resize: true });
    const nodeR = new Node(NODE_TYPES.WINDOW, winR);
    nodeR.settings = ctx.tree.settings;
    nodeR.mode = WINDOW_MODES.TILE;
    nodeR.percent = THIRD;
    nodeR.rect = { x: 600, y: 0, width: 300, height: 600 };
    monitor.appendChild(nodeR);

    return { container, nodeL, nodeA, nodeR, winA };
  }

  // Drag WinA's RIGHT edge: frame grows by `growBy` at the right (RESIZING_E).
  function dragRight(nodeA, winA, growBy) {
    nodeA.initRect = { x: 300, y: 0, width: 300, height: 600 };
    nodeA.initGrabOp = GrabOp.RESIZING_E;
    ctx.windowManager.grabOp = GrabOp.RESIZING_E;
    winA.get_frame_rect = () => new Rectangle({ x: 300, y: 0, width: 300 + growBy, height: 600 });
    ctx.display.get_focus_window.mockReturnValue(winA);
    ctx.windowManager._handleResizing(nodeA);
  }

  // Drag WinA's LEFT edge: frame grows by `growBy` at the left (RESIZING_W) —
  // x moves left, width increases.
  function dragLeft(nodeA, winA, growBy) {
    nodeA.initRect = { x: 300, y: 0, width: 300, height: 600 };
    nodeA.initGrabOp = GrabOp.RESIZING_W;
    ctx.windowManager.grabOp = GrabOp.RESIZING_W;
    winA.get_frame_rect = () =>
      new Rectangle({ x: 300 - growBy, y: 0, width: 300 + growBy, height: 600 });
    ctx.display.get_focus_window.mockReturnValue(winA);
    ctx.windowManager._handleResizing(nodeA);
  }

  it("resizing right grows the container against the RIGHT neighbor and leaves the LEFT untouched", () => {
    const v = buildMiddleTabbed(LAYOUT_TYPES.TABBED);
    dragRight(v.nodeA, v.winA, 90); // 300 -> 390 px

    expect(v.container.percent).toBeCloseTo((300 + 90) / 900, 5); // ~0.4333
    expect(v.nodeR.percent).toBeCloseTo((300 - 90) / 900, 5); // ~0.2333
    expect(v.nodeL.percent).toBeCloseTo(THIRD, 5); // untouched
    expect(v.container.percent + v.nodeL.percent + v.nodeR.percent).toBeCloseTo(1.0, 5);
  });

  it("resizing left grows the container against the LEFT neighbor and leaves the RIGHT untouched", () => {
    const v = buildMiddleTabbed(LAYOUT_TYPES.TABBED);
    dragLeft(v.nodeA, v.winA, 90);

    expect(v.container.percent).toBeCloseTo((300 + 90) / 900, 5);
    expect(v.nodeL.percent).toBeCloseTo((300 - 90) / 900, 5);
    expect(v.nodeR.percent).toBeCloseTo(THIRD, 5); // untouched
    expect(v.container.percent + v.nodeL.percent + v.nodeR.percent).toBeCloseTo(1.0, 5);
  });

  it("works the same for a STACKED middle container", () => {
    const v = buildMiddleTabbed(LAYOUT_TYPES.STACKED);
    dragRight(v.nodeA, v.winA, 90);

    expect(v.container.percent).toBeCloseTo((300 + 90) / 900, 5);
    expect(v.nodeR.percent).toBeCloseTo((300 - 90) / 900, 5);
    expect(v.nodeL.percent).toBeCloseTo(THIRD, 5);
  });
});
