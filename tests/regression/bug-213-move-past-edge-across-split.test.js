import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * forge-ext/forge#213: moving a window down (or up) past its monitor's edge,
 * when the monitor was split side by side, appended it to the monitor in the
 * monitor's own direction: the window went to the right, as a new column, so
 * a 2x2 grid became a row of three. It now lands below everything else, across
 * the whole monitor, as in i3.
 */
describe("#213: moving a window past the monitor's edge goes that way", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
    vi.spyOn(ctx.windowManager, "move").mockImplementation(() => {});
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const tiled = (parent, id) => {
    const node = ctx.tree.createNode(
      parent.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ id, workspace: ctx.workspaces[0] })
    );
    node.mode = WINDOW_MODES.TILE;
    return node;
  };
  const column = (monitor) => {
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    con.layout = LAYOUT_TYPES.VSPLIT;
    return con;
  };

  it("in a 2x2 grid, Down on a bottom window puts it below both columns", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const left = column(monitor);
    tiled(left, "A");
    const c = tiled(left, "C");
    const right = column(monitor);
    tiled(right, "B");
    tiled(right, "D");

    ctx.tree.move(c, MotionDirection.DOWN);

    expect(monitor.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(monitor.lastChild).toBe(c);
    const rest = monitor.firstChild;
    expect(rest.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(rest.contains(right)).toBe(true);
  });

  it("side by side, Up on a window puts it above the other", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = tiled(monitor, "A");
    const b = tiled(monitor, "B");

    ctx.tree.move(b, MotionDirection.UP);

    expect(monitor.layout).toBe(LAYOUT_TYPES.VSPLIT);
    expect(monitor.childNodes).toEqual([b, a]);
  });

  it("leaves a window alone on its monitor as it is", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = tiled(monitor, "A");

    ctx.tree.move(a, MotionDirection.DOWN);

    expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });
});
