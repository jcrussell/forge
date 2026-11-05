import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-5bdc: with auto-split on, trackWindow re-split the focused window by
 * its shape when a new window opened. split()'s single-child toggle then
 * overwrote the direction the user had just chosen with Super+V/Z: on a lone wide
 * window, Super+V then opening B put B beside it, not below.
 *
 * Fix: the user's Split records the choice on the node whose direction it set,
 * and auto-split skips while that window is still the only tiled child there.
 */
describe("Bug forge-5bdc: auto-split honours a direction chosen with Split", () => {
  let ctx;
  let monitor;
  const wm = () => ctx.windowManager;
  const wide = { x: 0, y: 0, width: 1600, height: 900 };

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "auto-split-enabled": true } });
    wm().renderTree = vi.fn();
    wm().queueEvent = vi.fn();
    wm().postProcessWindow = vi.fn();
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
  });

  afterEach(() => ctx.cleanup());

  const tile = (parent, id) => {
    const meta = createMockWindow({ id, rect: wide, workspace: ctx.workspaces[0] });
    ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, meta).mode = WINDOW_MODES.TILE;
    return meta;
  };

  const openNewWindow = (id) => {
    const meta = createMockWindow({ id, rect: wide, workspace: ctx.workspaces[0] });
    wm().trackWindow(ctx.display, meta);
    return meta;
  };

  it("keeps VSPLIT chosen for a lone wide window when the next window opens", () => {
    const a = tile(monitor, 1);
    ctx.display.get_focus_window.mockReturnValue(a);

    wm().command({ name: "Split", orientation: "vertical" });
    expect(monitor.layout).toBe(LAYOUT_TYPES.VSPLIT);

    const b = openNewWindow(2);

    expect(monitor.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(ctx.tree.findNode(b).parentNode).toBe(monitor);
  });

  it("keeps VSPLIT chosen in a new container beside a sibling", () => {
    const a = tile(monitor, 1);
    tile(monitor, 3);
    ctx.display.get_focus_window.mockReturnValue(a);

    wm().command({ name: "Split", orientation: "vertical" });
    const con = ctx.tree.findNode(a).parentNode;
    expect(con.nodeType).toBe(NODE_TYPES.CON);

    const b = openNewWindow(2);

    expect(con.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(ctx.tree.findNode(b).parentNode).toBe(con);
  });

  it("drops the choice once a tiled neighbour has used it and closed", () => {
    const a = tile(monitor, 1);
    ctx.display.get_focus_window.mockReturnValue(a);
    wm().command({ name: "Split", orientation: "vertical" });
    const bNode = ctx.tree.findNode(openNewWindow(2));
    bNode.mode = WINDOW_MODES.TILE; // as the next render tiles it
    ctx.tree.removeNode(bNode);

    openNewWindow(3);

    expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });

  it("still auto-splits by shape when the user chose nothing", () => {
    const a = tile(monitor, 1);
    monitor.layout = LAYOUT_TYPES.VSPLIT;
    ctx.display.get_focus_window.mockReturnValue(a);

    openNewWindow(2);

    expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });
});
