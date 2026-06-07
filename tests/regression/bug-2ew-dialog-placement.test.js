import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WindowType } from "../mocks/gnome/Meta.js";
import * as Utils from "../../lib/extension/utils.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-2ew: a transient dialog opened from a tiled window can inherit
 * Mutter placement that lands it BEHIND the tiled neighbor to its parent's
 * right, instead of clearly over its parent. Z-order is already handled
 * (dialog-z-order.test.js); this covers PLACEMENT.
 *
 * Fix: in processFloats(), when a transient dialog overlaps a tiled window
 * other than its parent, recenter it over its parent (clamped to the work area).
 */
describe("Bug forge-2ew: dialog not occluded by tiled neighbor", () => {
  let ctx;
  let parent;
  let neighbor;
  let nodeParent;
  let nodeNeighbor;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    // Two tiled windows splitting a 1920-wide work area: parent left, neighbor right.
    parent = createMockWindow({
      id: 3001,
      title: "Editor",
      rect: { x: 0, y: 0, width: 960, height: 1080 },
    });
    neighbor = createMockWindow({
      id: 3002,
      title: "Browser",
      rect: { x: 960, y: 0, width: 960, height: 1080 },
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    nodeParent = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, parent);
    nodeNeighbor = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, neighbor);
    nodeParent.mode = WINDOW_MODES.TILE;
    nodeNeighbor.mode = WINDOW_MODES.TILE;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("recenters a dialog that lands over the tiled neighbor", () => {
    // Dialog from `parent` but Mutter placed it overlapping the right neighbor.
    const dialog = createMockWindow({
      id: 3003,
      title: "Open File",
      window_type: WindowType.DIALOG,
      transient_for: parent,
      rect: { x: 1000, y: 400, width: 400, height: 300 },
    });
    ctx.tree.createNode(
      ctx.tree.getNodeByType(NODE_TYPES.MONITOR)[0].nodeValue,
      NODE_TYPES.WINDOW,
      dialog
    );

    // Pre-condition: it overlaps the neighbor.
    expect(Utils.rectsOverlap(dialog.get_frame_rect(), neighbor.get_frame_rect())).toBe(true);

    ctx.windowManager.processFloats();

    const dRect = dialog.get_frame_rect();
    // It is centered over the parent and no longer occluded by the neighbor.
    expect(Utils.rectsOverlap(dRect, neighbor.get_frame_rect())).toBe(false);
    expect(dRect.x).toBe(280); // 0 + (960 - 400)/2
    expect(dRect.y).toBe(390); // 0 + (1080 - 300)/2
  });

  it("leaves a dialog that is already over its parent untouched", () => {
    const dialog = createMockWindow({
      id: 3004,
      title: "Find",
      window_type: WindowType.DIALOG,
      transient_for: parent,
      rect: { x: 300, y: 300, width: 200, height: 150 },
    });
    ctx.tree.createNode(
      ctx.tree.getNodeByType(NODE_TYPES.MONITOR)[0].nodeValue,
      NODE_TYPES.WINDOW,
      dialog
    );

    ctx.windowManager.processFloats();

    const dRect = dialog.get_frame_rect();
    expect(dRect.x).toBe(300);
    expect(dRect.y).toBe(300);
  });

  it("does not move a non-transient float even if it overlaps a tiled window", () => {
    // A free-floating window (no transient parent) the user positioned themselves.
    const floatWin = createMockWindow({
      id: 3005,
      title: "Picture-in-Picture",
      rect: { x: 1000, y: 400, width: 400, height: 300 },
    });
    const nodeFloat = ctx.tree.createNode(
      ctx.tree.getNodeByType(NODE_TYPES.MONITOR)[0].nodeValue,
      NODE_TYPES.WINDOW,
      floatWin
    );
    nodeFloat.mode = WINDOW_MODES.FLOAT;
    // Float it via an explicit override so processFloats keeps it floating.
    ctx.configMgr.windowProps.overrides = [{ wmId: 3005, wmClass: "TestApp", mode: "float" }];

    ctx.windowManager.processFloats();

    const fRect = floatWin.get_frame_rect();
    expect(fRect.x).toBe(1000);
    expect(fRect.y).toBe(400);
  });
});
