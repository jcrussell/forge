import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createTreeFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-ext/forge#548: a tabbed CON that auto-exit-tabbed (or the tabbed
 * toggle) switched back to a split keeps its decoration actor. removeChild only
 * tears down the decoration of a CON that is still stacked/tabbed, so when the
 * last window of such a CON closed, its tab bar stayed on screen.
 */
describe("Bug #548: tab bar of a container that is no longer tabbed", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
  });

  it("destroys the decoration when the emptied CON leaves the tree", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    createWindowNode(ctx.tree, monitor); // keeps the monitor from being emptied
    const con = createContainerNode(monitor, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const w1 = createWindowNode(ctx.tree, con).nodeWindow;
    con._createDecoration();
    const decoration = con.decoration;
    expect(decoration).toBeTruthy();

    con.layout = LAYOUT_TYPES.HSPLIT; // what auto-exit-tabbed does with one tab left
    ctx.tree.removeNode(w1);

    expect(con.decoration).toBe(null);
    expect(global.window_group.contains(decoration)).toBe(false);
  });
});
