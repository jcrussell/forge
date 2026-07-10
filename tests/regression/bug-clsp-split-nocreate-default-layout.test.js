import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-clsp: the Split command unconditionally applies default-window-layout
 * to focusNodeWindow.parentNode even when tree.split did NOT create a container.
 * tree.split has two non-creating exits — a FLOAT focus (plain return) and a
 * single-child parent (toggles the EXISTING parent's orientation, often the
 * MONITOR node). With default-window-layout=tabbed/stacked, applyDefaultLayout
 * then turns that pre-existing container (the monitor) TABBED, permanently.
 *
 * Fix: tree.split returns the newly-created CON (null otherwise); Split applies
 * the default layout only when a container was actually created.
 */
describe("Bug forge-clsp: Split does not tab a pre-existing container", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "default-window-layout": "tabbed",
        "tabbed-tiling-mode-enabled": true,
      },
    });
    wm().renderTree = vi.fn();
  });

  afterEach(() => ctx.cleanup());

  it("leaves the MONITOR split intact on a single-child toggle-split", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const win = createMockWindow({ wm_class: "App", id: 1, allows_resize: true });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    ctx.display.get_focus_window.mockReturnValue(win);

    wm().command({ name: "Split", orientation: "horizontal" });

    expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });

  it("leaves the host container intact when focus is a FLOAT window", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const t0 = createMockWindow({ wm_class: "A", id: 10, allows_resize: true });
    const t1 = createMockWindow({ wm_class: "B", id: 11, allows_resize: true });
    const dialog = createMockWindow({ wm_class: "D", id: 12, allows_resize: true });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, t0).mode = WINDOW_MODES.TILE;
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, t1).mode = WINDOW_MODES.TILE;
    const dialogNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dialog);
    dialogNode.mode = WINDOW_MODES.FLOAT;
    ctx.display.get_focus_window.mockReturnValue(dialog);

    wm().command({ name: "Split", orientation: "horizontal" });

    expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });
});
