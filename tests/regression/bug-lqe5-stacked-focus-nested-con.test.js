import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-lqe5: _selectFocusWindow returned `container.lastChild` unfiltered for
 * STACKED containers. A stacked container can legitimately end with a nested
 * CON child (Split a child of a split con, then LayoutStackedToggle on the
 * parent — command.js itself checks for non-WINDOW lastChild), whose nodeValue
 * is an St.Bin; the caller then crashed on `metaWindow.raise()`. It also
 * returned minimized windows the method's own filter had just excluded.
 *
 * Fix: for STACKED, return the last eligible WINDOW in the subtree.
 */
describe("forge-lqe5: directional focus into a stacked container", () => {
  let ctx;
  let monitorNode;
  let nodeA;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitorNode = monitor;
    monitorNode.layout = LAYOUT_TYPES.HSPLIT;
    monitorNode.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    ctx.extWm.currentMonWsNode = monitorNode;

    const windowA = createMockWindow({ id: "A" });
    nodeA = ctx.tree.createNode(monitorNode.nodeValue, NODE_TYPES.WINDOW, windowA);
    nodeA.mode = WINDOW_MODES.TILE;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function addStackedContainer(children) {
    const container = new Node(NODE_TYPES.CON, new Bin());
    container.layout = LAYOUT_TYPES.STACKED;
    monitorNode.appendChild(container);
    for (const child of children) container.appendChild(child);
    return container;
  }

  function windowNode(id, { minimized = false } = {}) {
    const win = createMockWindow({ id });
    win.minimized = minimized;
    const node = new Node(NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  it("does not crash when the stack's last child is a nested CON (Bug #57 shape)", () => {
    // Stacked container: [ B, CON[ D ] ] — lastChild is the nested CON.
    const nodeB = windowNode("B");
    const nested = new Node(NODE_TYPES.CON, new Bin());
    nested.layout = LAYOUT_TYPES.VSPLIT;
    const nodeD = windowNode("D");
    nested.appendChild(nodeD);
    addStackedContainer([nodeB, nested]);

    const result = ctx.tree.focus(nodeA, MotionDirection.RIGHT);

    // Pre-fix: TypeError (St.Bin has no raise). Post-fix: the last eligible
    // window in the stack's subtree.
    expect(result).toBe(nodeD);
  });

  it("returns the top eligible window when the stack ends in a minimized window", () => {
    const nodeB = windowNode("B");
    const nodeC = windowNode("C", { minimized: true });
    addStackedContainer([nodeB, nodeC]);

    const result = ctx.tree.focus(nodeA, MotionDirection.RIGHT);

    expect(result).toBe(nodeB);
  });

  it("still focuses the top (last) window of a plain stack", () => {
    const nodeB = windowNode("B");
    const nodeC = windowNode("C");
    addStackedContainer([nodeB, nodeC]);

    const result = ctx.tree.focus(nodeA, MotionDirection.RIGHT);

    expect(result).toBe(nodeC);
  });
});
