import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
 * A centre drop on a window in a split container previews the container's
 * rect. A container the render has not laid out yet has none, and the drop
 * threw; at the end of a drag that left the dragged window in GRAB_TILE with
 * its preview on screen.
 */
describe("a centre drop on a window in a container with no rect yet", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "dnd-center-layout": "TABBED" } });
  });

  afterEach(() => ctx.cleanup());

  it("drops into the container instead of throwing", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const rect = new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 });
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new (class {})());
    con.layout = LAYOUT_TYPES.HSPLIT;
    const target = ctx.tree.createNode(
      con.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ rect, workspace: ctx.workspaces[0] })
    );
    target.mode = WINDOW_MODES.TILE;
    const dragged = ctx.tree.createNode(
      monitor.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ rect, workspace: ctx.workspaces[0] })
    );
    dragged.mode = WINDOW_MODES.GRAB_TILE;
    expect(con.rect).toBeNull();
    setPointer(960, 540);
    ctx.windowManager.nodeWinAtPointer = target;

    expect(() => ctx.windowManager.moveWindowToPointer(dragged, false)).not.toThrow();
    expect(dragged.parentNode).toBe(con);
  });
});
