import { describe, it, expect, beforeEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  setPointer,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Bug #151 regression: on Wayland, touch/stylus drags move the window while
 * the MOUSE pointer (the only thing global.get_pointer() reports) stays
 * parked wherever it last was. All drag-target resolution used
 * global.get_pointer(), so the drop target/preview tracked the stale mouse
 * position instead of the dragged window.
 *
 * Device-agnostic fix: _handleGrabOpBegin snapshots the pointer; while the
 * pointer has not moved since grab start (touch/stylus drag), the reference
 * coordinate is derived from the dragged window's frame (which Mutter moves
 * with the touch point) instead of the stale pointer.
 */
describe("Bug #151: touch/stylus drag target resolution", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "dnd-center-layout": "SWAP" },
    });
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  function buildScene() {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    // Two tiled windows side by side.
    const metaA = createMockWindow({
      rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
      workspace: workspace0(),
    });
    const nodeA = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaA);
    nodeA.mode = WINDOW_MODES.TILE;

    const metaC = createMockWindow({
      rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
      workspace: workspace0(),
    });
    const nodeC = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaC);
    nodeC.mode = WINDOW_MODES.TILE;

    // Dragged window: its frame follows the touch point and now hovers over A.
    const metaB = createMockWindow({
      rect: new Rectangle({ x: 100, y: 100, width: 400, height: 400 }),
      workspace: workspace0(),
    });
    const nodeB = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaB);
    nodeB.mode = WINDOW_MODES.GRAB_TILE;

    // What trackCurrentMonWs builds at grab begin: stack-sorted tiled windows
    // excluding the dragged one.
    wm().sortedWindows = [metaA, metaC];

    return { nodeA, nodeB, nodeC };
  }

  it("touch drag (pointer static since grab start) resolves the window under the dragged frame", () => {
    const { nodeA, nodeB } = buildScene();

    // Mouse pointer parked over C since before the grab.
    setPointer(1400, 540);
    wm()._grabStartPointer = [1400, 540];

    expect(wm().findNodeWindowAtPointer(nodeB)).toBe(nodeA);
  });

  it("mouse drag (pointer moved since grab start) keeps pointer-based resolution", () => {
    const { nodeB, nodeC } = buildScene();

    // Pointer moved during the grab: it is live, trust it even though the
    // dragged frame is elsewhere.
    setPointer(1400, 540);
    wm()._grabStartPointer = [200, 200];

    expect(wm().findNodeWindowAtPointer(nodeB)).toBe(nodeC);
  });

  it("no grab snapshot behaves like a mouse drag", () => {
    const { nodeB, nodeC } = buildScene();

    setPointer(1400, 540);
    wm()._grabStartPointer = null;

    expect(wm().findNodeWindowAtPointer(nodeB)).toBe(nodeC);
  });

  it("touch drop executes against the frame-derived zone", () => {
    const { nodeA, nodeB } = buildScene();

    setPointer(1400, 540);
    wm()._grabStartPointer = [1400, 540];
    wm().nodeWinAtPointer = nodeA;

    // Frame-derived reference is B's frame top-center (300, 108): the TOP zone
    // of A. The stale pointer (1400, 540) is outside A entirely, so today the
    // drop is silently ignored.
    wm().moveWindowToPointer(nodeB, false);

    expect(nodeB.parentNode.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(nodeB.parentNode).toBe(nodeA.parentNode);
  });
});
