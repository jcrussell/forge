import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { WindowType } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-3hsv: opening a dialog corrupts a custom-resized split.
 *
 * trackWindow used to call tree.insertChildPercent() UNCONDITIONALLY for every
 * new node. DIALOG/MODAL_DIALOG/transient windows are tracked but permanently
 * float-exempt (processFloats keeps them FLOAT forever), yet insertChildPercent
 * still carved them a tiled share and rescaled the real tiled siblings to sum to
 * 1 - share. The phantom share then got folded (Bug #330) onto one window,
 * visibly flipping a 60/40 split toward 40/60.
 *
 * Fix: gate insertChildPercent on !isFloatingExempt(metaWindow), so a window
 * that will never tile never disturbs the tiled siblings' percents.
 */
describe("Bug forge-3hsv: a dialog does not claim a tiled share", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    ctx.display.get_current_monitor.mockReturnValue(0);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  it("keeps the existing 60/40 split intact when a DIALOG is tracked", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    // Two tiled windows manually resized to a 60/40 split.
    const winA = createMockWindow({ id: "A", workspace: ctx.workspaces[0], monitor: 0 });
    const nodeA = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, winA);
    nodeA.mode = WINDOW_MODES.TILE;
    nodeA.percent = 0.6;

    const winB = createMockWindow({ id: "B", workspace: ctx.workspaces[0], monitor: 0 });
    const nodeB = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, winB);
    nodeB.mode = WINDOW_MODES.TILE;
    nodeB.percent = 0.4;

    // The dialog opens from window A — it attaches as a sibling in the same split.
    ctx.tree.attachNode = nodeA;

    const dialog = createMockWindow({
      id: "dialog",
      workspace: ctx.workspaces[0],
      monitor: 0,
      window_type: WindowType.DIALOG,
    });

    wm().trackWindow(null, dialog);

    // The dialog is tracked, but it must not have stolen a tiled share: the two
    // real tiled siblings still sum to ~1 and keep their 0.6 / 0.4 proportions.
    expect(nodeA.percent + nodeB.percent).toBeCloseTo(1.0, 5);
    expect(nodeA.percent).toBeCloseTo(0.6, 5);
    expect(nodeB.percent).toBeCloseTo(0.4, 5);
  });
});
