import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture, getWorkspaceAndMonitor } from "../mocks/helpers/index.js";

/**
 * forge-ext/forge#563: a split container made tabbed or stacked and back went
 * back to a direction taken from the monitor's shape, not the one it had.
 */
describe("Bug #563: tabbed and stacked groups go back to their split direction", () => {
  let ctx;
  let con;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, null);
  });

  it("remembers the split direction a group had", () => {
    con.layout = LAYOUT_TYPES.VSPLIT;
    con.layout = LAYOUT_TYPES.TABBED;
    con.layout = LAYOUT_TYPES.STACKED; // switching between group kinds keeps it
    con.restoreSplitLayout(LAYOUT_TYPES.HSPLIT);
    expect(con.layout).toBe(LAYOUT_TYPES.VSPLIT);
  });

  it("falls back for a container created as a group", () => {
    con.layout = LAYOUT_TYPES.VSPLIT;
    con.setGroupLayout(LAYOUT_TYPES.TABBED, false);
    con.restoreSplitLayout(LAYOUT_TYPES.HSPLIT);
    expect(con.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });
});
