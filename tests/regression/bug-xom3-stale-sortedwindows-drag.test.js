import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  setPointer,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * forge-xom3: this.sortedWindows is snapshotted at grab start (trackCurrentMonWs)
 * and never pruned when a window closes mid-drag. _findNodeWindowAtPointer
 * iterated the cache calling w.get_frame_rect() with no liveness check, so a
 * disposed wrapper threw on every pointer motion (freezing the drop preview),
 * and even before finalization a dead window's stale rect could mask a live
 * drop target underneath.
 *
 * Fix: skip dead windows (Utils.isWindowAlive) in the scan loop.
 */
describe("forge-xom3: stale sortedWindows entry during a tile drag", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  function buildScene() {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    // Live tiled window occupying the right half.
    const liveWin = createMockWindow({
      rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
      workspace: workspace0(),
    });
    const liveNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, liveWin);
    liveNode.mode = WINDOW_MODES.TILE;

    // Dragged window.
    const draggedWin = createMockWindow({
      rect: new Rectangle({ x: 100, y: 100, width: 400, height: 400 }),
      workspace: workspace0(),
    });
    const draggedNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, draggedWin);
    draggedNode.mode = WINDOW_MODES.GRAB_TILE;

    // A window that closed mid-drag: its wrapper is finalized so every method
    // throws. It is stack-sorted ABOVE the live window in the stale cache.
    const deadWin = createMockWindow({
      rect: new Rectangle({ x: 960, y: 0, width: 960, height: 1080 }),
      workspace: workspace0(),
    });
    const disposed = () => {
      throw new Error("Object Meta.Window (0xdead), has been already deallocated");
    };
    deadWin.get_id = disposed;
    deadWin.get_frame_rect = disposed;

    // What trackCurrentMonWs left behind: the dead window precedes the live one.
    wm().sortedWindows = [deadWin, liveWin];

    return { liveWin, liveNode, draggedNode };
  }

  it("skips the dead window without throwing and returns the live drop target", () => {
    const { liveWin, liveNode, draggedNode } = buildScene();

    // Pointer hovering over the right half where both the dead and live
    // windows are located.
    setPointer(1400, 540);
    wm()._grabStartPointer = [200, 200]; // pointer moved => use the live pointer

    let result;
    expect(() => {
      result = wm().findNodeWindowAtPointer(draggedNode);
    }).not.toThrow();

    expect(result).toBe(liveNode);
    expect(result).toBe(ctx.tree.getNodeByValue(liveWin));
  });
});
