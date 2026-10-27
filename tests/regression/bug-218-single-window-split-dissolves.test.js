import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-ext/forge#218: closing the second-to-last window of a split container
 * left the last one alone in it, an extra level that later moves, splits and
 * resizes acted on. The window now takes the container's place and share.
 */
describe("#218: a split left with one window gives way to it", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
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

  // monitor HSPLIT[W, VSPLIT[A, B]], the column at 40%
  function build() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const w = tiled(monitor, "W");
    w.percent = 0.6;
    const column = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    column.layout = LAYOUT_TYPES.VSPLIT;
    column.percent = 0.4;
    const a = tiled(column, "A");
    const b = tiled(column, "B");
    return { monitor, w, column, a, b };
  }

  it("puts the last window where its container was, with its share", () => {
    const { monitor, w, column, a, b } = build();

    ctx.tree.removeNode(b);

    expect(monitor.childNodes).toEqual([w, a]);
    expect(a.percent).toBe(0.4);
    expect(column.parentNode).toBeFalsy();
  });

  it("does the same for a tab group that went back to a split", () => {
    const { monitor, w, column, a, b } = build();
    column.layout = LAYOUT_TYPES.TABBED;
    ctx.settings.set_boolean("auto-exit-tabbed", true);

    ctx.tree.removeNode(b);

    expect(monitor.childNodes).toEqual([w, a]);
  });

  it("keeps a stack or tab group of one when it isn't left automatically", () => {
    const { column, a, b } = build();
    column.layout = LAYOUT_TYPES.STACKED;

    ctx.tree.removeNode(b);

    expect(a.parentNode).toBe(column);
  });

  it("keeps the split when a floating window in it closes", () => {
    const { monitor, a, b } = build();
    ctx.tree.removeNode(b);
    // Split on A, then a dialog of A's app opens (floating) in that split
    const split = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    split.layout = LAYOUT_TYPES.VSPLIT;
    split.appendChild(a);
    const dialog = tiled(split, "D");
    dialog.mode = WINDOW_MODES.FLOAT;

    ctx.tree.removeNode(dialog);

    expect(a.parentNode).toBe(split);
  });

  it("keeps a container the user split for one window while others close", () => {
    const { monitor, w, a, b } = build();
    ctx.tree.removeNode(b);
    // Split on A: a container for one window, for the next one to open in
    const split = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    split.layout = LAYOUT_TYPES.VSPLIT;
    split.appendChild(a);
    const x = tiled(monitor, "X");

    ctx.tree.removeNode(x);

    expect(a.parentNode).toBe(split);
    expect(monitor.childNodes).toEqual([w, split]);
  });
});
