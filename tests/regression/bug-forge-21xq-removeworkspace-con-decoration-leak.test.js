import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture, createMockWindow } from "../mocks/helpers/index.js";

/**
 * Bug forge-21xq (audit-2026-07b): the forge-98sa teardown collects the workspace
 * actorBin and each MONITOR actorBin, then splices the subtree out. But a
 * STACKED/TABBED CON inside that subtree owns a decoration St.BoxLayout that
 * Node._createDecoration parented directly into global.window_group, and
 * Tree.removeChild only tears down the decoration of the node handed to it (a
 * WORKSPACE node, which is always HSPLIT).
 *
 * After the splice the CON is unreachable from the tree, so
 * DecorationManager.updateDecorationLayout() — which iterates
 * tree.getNodeByType(CON) — can no longer hide it and cleanTree() can no longer
 * collect it. It stays parented in window_group for the rest of the session, and
 * stays DRAWN if the last render had shown it.
 *
 * Reachable whenever _containerFullyMigrates returns false (the forge-c2yp
 * finalized-wrapper race, or a transient get_monitor() === -1), so the live
 * windows are re-homed individually and the emptied CON is spliced out.
 *
 * Fix: destroy the subtree's CON decorations before removeChild.
 */
describe("Bug forge-21xq: removeWorkspace tears down descendant CON decorations", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      globals: { workspaceManager: { workspaceCount: 2 }, monitorCount: 1 },
      settings: { "tiling-mode-enabled": true },
    });
  });

  afterEach(() => ctx.cleanup());

  /** Build a TABBED container with a live decoration under ws1. */
  function tabbedConOnWs1() {
    const monitor = ctx.tree.findNode("ws1").getNodeByType(NODE_TYPES.MONITOR)[0];
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, LAYOUT_TYPES.HSPLIT);
    con.layout = LAYOUT_TYPES.TABBED;
    ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 1 }));
    con._createDecoration();
    return con;
  }

  it("removes the CON's decoration from window_group", () => {
    const wg = global.window_group;
    const con = tabbedConOnWs1();
    const decoration = con.decoration;

    expect(decoration).toBeTruthy();
    expect(wg.contains(decoration)).toBe(true);

    ctx.tree.removeWorkspace(1);

    expect(wg.contains(decoration)).toBe(false);
    expect(con.decoration).toBeNull();
  });

  it("leaves a CON decoration on an unrelated workspace intact", () => {
    const wg = global.window_group;
    const monitor = ctx.tree.findNode("ws0").getNodeByType(NODE_TYPES.MONITOR)[0];
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, LAYOUT_TYPES.HSPLIT);
    con.layout = LAYOUT_TYPES.TABBED;
    con._createDecoration();

    ctx.tree.removeWorkspace(1);

    expect(wg.contains(con.decoration)).toBe(true);
  });

  it("still removes the workspace and its scaffold bins", () => {
    const wg = global.window_group;
    const ws1 = ctx.tree.findNode("ws1");
    const bins = [ws1.actorBin, ...ws1.getNodeByType(NODE_TYPES.MONITOR).map((m) => m.actorBin)];
    tabbedConOnWs1();

    expect(ctx.tree.removeWorkspace(1)).toBe(true);

    expect(ctx.tree.findNode("ws1")).toBeFalsy();
    bins.forEach((bin) => expect(wg.contains(bin)).toBe(false));
  });

  it("does not throw when a CON has no decoration", () => {
    const monitor = ctx.tree.findNode("ws1").getNodeByType(NODE_TYPES.MONITOR)[0];
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, LAYOUT_TYPES.HSPLIT);

    expect(() => ctx.tree.removeWorkspace(1)).not.toThrow();
  });
});
