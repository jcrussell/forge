import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-nl8: opt-in re-orient of a split container by its aspect ratio when a
 * child closes.
 *
 * When `auto-reorient-on-close` is ON, removing a child from a real split
 * container (HSPLIT/VSPLIT) re-derives the orientation from the container's
 * current rect (portrait -> VSPLIT, landscape -> HSPLIT). It is DEFAULT OFF so
 * existing users see zero behavior change, and is strictly guarded so an
 * explicit TABBED/STACKED choice is never touched.
 */
describe("forge-nl8: re-orient split container on close (opt-in)", () => {
  function build(settings) {
    const ctx = createTreeFixture({ fullExtWm: true, settings });
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
    return ctx;
  }

  /** Build a split CON with `count` window children under the monitor. */
  function splitCon(ctx, layout, rect, count = 2) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    container.layout = layout;
    container.rect = rect;
    for (let i = 0; i < count; i++) {
      ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
    }
    return container;
  }

  describe("setting ON", () => {
    it("flips HSPLIT -> VSPLIT when the container rect is now portrait", () => {
      const ctx = build({ "auto-reorient-on-close": true });
      const con = splitCon(ctx, LAYOUT_TYPES.HSPLIT, { x: 0, y: 0, width: 600, height: 1200 });

      ctx.tree.removeNode(con.firstChild);

      expect(con.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("keeps HSPLIT when the container rect stays landscape", () => {
      const ctx = build({ "auto-reorient-on-close": true });
      const con = splitCon(ctx, LAYOUT_TYPES.HSPLIT, { x: 0, y: 0, width: 1600, height: 900 });

      ctx.tree.removeNode(con.firstChild);

      expect(con.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("flips VSPLIT -> HSPLIT when the container rect is now landscape", () => {
      const ctx = build({ "auto-reorient-on-close": true });
      const con = splitCon(ctx, LAYOUT_TYPES.VSPLIT, { x: 0, y: 0, width: 1600, height: 900 });

      ctx.tree.removeNode(con.firstChild);

      expect(con.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("does NOT reorient a TABBED container (guard holds)", () => {
      const ctx = build({ "auto-reorient-on-close": true, "auto-exit-tabbed": false });
      // Portrait rect would flip a split, but TABBED must be left alone.
      const con = splitCon(ctx, LAYOUT_TYPES.TABBED, { x: 0, y: 0, width: 600, height: 1200 }, 3);

      ctx.tree.removeNode(con.firstChild);

      expect(con.layout).toBe(LAYOUT_TYPES.TABBED);
    });

    it("does NOT reorient a STACKED container (guard holds)", () => {
      const ctx = build({ "auto-reorient-on-close": true });
      const con = splitCon(ctx, LAYOUT_TYPES.STACKED, { x: 0, y: 0, width: 600, height: 1200 }, 3);

      ctx.tree.removeNode(con.firstChild);

      expect(con.layout).toBe(LAYOUT_TYPES.STACKED);
    });

    it("derives orientation from the container rect on tabbed-exit (portrait -> VSPLIT)", () => {
      const ctx = build({ "auto-reorient-on-close": true, "auto-exit-tabbed": true });
      // Landscape monitor (default mock) but a PORTRAIT container: the tabbed
      // exit must follow the container, not the monitor.
      const con = splitCon(ctx, LAYOUT_TYPES.TABBED, { x: 0, y: 0, width: 600, height: 1200 }, 2);

      ctx.tree.removeNode(con.firstChild);

      expect(con.layout).toBe(LAYOUT_TYPES.VSPLIT);
    });
  });

  describe("setting OFF (default)", () => {
    it("does NOT reorient a split container on close", () => {
      const ctx = build({}); // auto-reorient-on-close defaults false
      // Portrait rect: if reorient ran it would flip to VSPLIT.
      const con = splitCon(ctx, LAYOUT_TYPES.HSPLIT, { x: 0, y: 0, width: 600, height: 1200 });

      ctx.tree.removeNode(con.firstChild);

      expect(con.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("tabbed-exit still uses monitor-based determineSplitLayout (landscape -> HSPLIT)", () => {
      const ctx = build({ "auto-exit-tabbed": true });
      // Portrait container, but with reorient OFF the exit follows the monitor
      // (landscape default mock -> HSPLIT), preserving prior behavior.
      const con = splitCon(ctx, LAYOUT_TYPES.TABBED, { x: 0, y: 0, width: 600, height: 1200 }, 2);

      ctx.tree.removeNode(con.firstChild);

      expect(con.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });
  });
});
