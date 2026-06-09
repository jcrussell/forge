import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture, getWorkspaceAndMonitor } from "../mocks/helpers/index.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";
import { Rectangle } from "../mocks/gnome/Meta.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-bqa (gh-401): STACKED/TABBED layouts are lost across a tree reload.
 *
 * reloadTree() does tree.reload() (which clears every CON node — node.layout is
 * in-memory only) and then re-tracks the windows FLAT under their monitor, so a
 * reload (e.g. the extension re-enabling on resume) turns a stack/tab back into
 * a side-by-side split.
 *
 * Fix: snapshotLayoutGroups() captures the flat STACKED/TABBED groupings before
 * reload; restoreLayoutGroups() re-wraps the surviving windows afterwards. These
 * tests drive the real helpers with pure tree operations (the flatten step
 * simulates what trackCurrentWindows produces after reload()).
 */
describe("forge-bqa: stacked/tabbed layout survives a tree reload", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function makeWindow(i) {
    return createMockWindow({
      id: `bqa-w${i}`,
      rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
    });
  }

  // monitor -> CON(layout) -> N windows
  function buildGroup(layout, count) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    con.layout = layout;
    const windows = [];
    for (let i = 0; i < count; i++) {
      const meta = makeWindow(i);
      ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, meta);
      windows.push(meta);
    }
    return { monitor, con, windows };
  }

  // Simulate what reload()+trackCurrentWindows produces: the given windows are
  // re-added flat under the monitor and the grouping CON is gone.
  function flattenUnderMonitor(monitor, windows) {
    // Drop every existing child of the monitor (the old CON), then re-add the
    // windows directly — mirroring a from-scratch rebuild.
    monitor.childNodes.length = 0;
    return windows.map((meta) => ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta));
  }

  it("restores a STACKED group of windows after a flat rebuild", () => {
    const { monitor, windows } = buildGroup(LAYOUT_TYPES.STACKED, 3);

    const snapshot = ctx.tree.snapshotLayoutGroups();
    expect(snapshot).toHaveLength(1);

    flattenUnderMonitor(monitor, windows);
    // Bug repro: after the flat rebuild there is no STACKED con.
    expect(ctx.tree.getNodeByLayout(LAYOUT_TYPES.STACKED)).toHaveLength(0);

    ctx.tree.restoreLayoutGroups(snapshot);

    const stacked = ctx.tree.getNodeByLayout(LAYOUT_TYPES.STACKED);
    expect(stacked).toHaveLength(1);
    const con = stacked[0];
    expect(con.parentNode).toBe(monitor);
    expect(con.childNodes.map((n) => n.nodeValue)).toEqual(windows);
  });

  it("restores a TABBED group and its lastTabFocus", () => {
    const { monitor, con, windows } = buildGroup(LAYOUT_TYPES.TABBED, 2);
    con.lastTabFocus = windows[1];

    const snapshot = ctx.tree.snapshotLayoutGroups();
    flattenUnderMonitor(monitor, windows);
    ctx.tree.restoreLayoutGroups(snapshot);

    const tabbed = ctx.tree.getNodeByLayout(LAYOUT_TYPES.TABBED);
    expect(tabbed).toHaveLength(1);
    expect(tabbed[0].lastTabFocus).toBe(windows[1]);
  });

  it("falls back to a survivor when the snapshotted lastTabFocus window is gone", () => {
    const { monitor, con, windows } = buildGroup(LAYOUT_TYPES.TABBED, 3);
    // The focused tab is windows[2]; it does not come back after the reload.
    con.lastTabFocus = windows[2];

    const snapshot = ctx.tree.snapshotLayoutGroups();
    flattenUnderMonitor(monitor, [windows[0], windows[1]]);
    ctx.tree.restoreLayoutGroups(snapshot);

    const tabbed = ctx.tree.getNodeByLayout(LAYOUT_TYPES.TABBED);
    expect(tabbed).toHaveLength(1);
    // lastTabFocus must point at a surviving window, never the closed one.
    expect(tabbed[0].lastTabFocus).toBe(windows[0]);
  });

  it("wraps only the survivors when one window of the group is gone", () => {
    const { monitor, windows } = buildGroup(LAYOUT_TYPES.STACKED, 3);
    const snapshot = ctx.tree.snapshotLayoutGroups();

    // One window did not come back (closed during suspend).
    flattenUnderMonitor(monitor, [windows[0], windows[2]]);
    ctx.tree.restoreLayoutGroups(snapshot);

    const stacked = ctx.tree.getNodeByLayout(LAYOUT_TYPES.STACKED);
    expect(stacked).toHaveLength(1);
    expect(stacked[0].childNodes.map((n) => n.nodeValue)).toEqual([windows[0], windows[2]]);
  });

  it("does not create a CON when only one window of the group survives", () => {
    const { monitor, windows } = buildGroup(LAYOUT_TYPES.STACKED, 3);
    const snapshot = ctx.tree.snapshotLayoutGroups();

    flattenUnderMonitor(monitor, [windows[1]]);
    ctx.tree.restoreLayoutGroups(snapshot);

    expect(ctx.tree.getNodeByLayout(LAYOUT_TYPES.STACKED)).toHaveLength(0);
    expect(monitor.childNodes).toHaveLength(1);
    expect(monitor.childNodes[0].isWindow()).toBe(true);
  });

  // forge-4y80: a STACKED/TABBED group containing a nested sub-split CON (the
  // Bug #57 shape) must survive the reload with its nesting intact, not flatten.
  it("restores a nested-CON group (TABBED over an inner HSPLIT) after a flat rebuild", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    // outer TABBED -> [ inner HSPLIT -> [w0, w1], w2 ]
    const outer = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    outer.layout = LAYOUT_TYPES.TABBED;
    const innerCon = ctx.tree.createNode(outer.nodeValue, NODE_TYPES.CON, new Bin());
    innerCon.layout = LAYOUT_TYPES.HSPLIT;
    const w0 = makeWindow(0);
    const w1 = makeWindow(1);
    const w2 = makeWindow(2);
    ctx.tree.createNode(innerCon.nodeValue, NODE_TYPES.WINDOW, w0);
    ctx.tree.createNode(innerCon.nodeValue, NODE_TYPES.WINDOW, w1);
    ctx.tree.createNode(outer.nodeValue, NODE_TYPES.WINDOW, w2);

    const snapshot = ctx.tree.snapshotLayoutGroups();
    expect(snapshot).toHaveLength(1);

    // The reload re-adds ALL nested leaf windows flat under the monitor.
    flattenUnderMonitor(monitor, [w0, w1, w2]);
    expect(ctx.tree.getNodeByLayout(LAYOUT_TYPES.TABBED)).toHaveLength(0);

    ctx.tree.restoreLayoutGroups(snapshot);

    // Outer TABBED rebuilt directly under the monitor.
    const tabbed = ctx.tree.getNodeByLayout(LAYOUT_TYPES.TABBED);
    expect(tabbed).toHaveLength(1);
    const outerRebuilt = tabbed[0];
    expect(outerRebuilt.parentNode).toBe(monitor);
    expect(outerRebuilt.childNodes).toHaveLength(2);

    // First child is the inner HSPLIT CON wrapping w0, w1; second is w2.
    const [firstChild, secondChild] = outerRebuilt.childNodes;
    expect(firstChild.isCon()).toBe(true);
    expect(firstChild.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(firstChild.childNodes.map((n) => n.nodeValue)).toEqual([w0, w1]);
    expect(secondChild.isWindow()).toBe(true);
    expect(secondChild.nodeValue).toBe(w2);
  });

  it("collapses a nested CON to its single survivor (no degenerate container)", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    // outer STACKED -> [ inner HSPLIT -> [w0, w1], w2 ]; only w0 + w2 survive.
    const outer = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    outer.layout = LAYOUT_TYPES.STACKED;
    const innerCon = ctx.tree.createNode(outer.nodeValue, NODE_TYPES.CON, new Bin());
    innerCon.layout = LAYOUT_TYPES.HSPLIT;
    const w0 = makeWindow(0);
    const w1 = makeWindow(1);
    const w2 = makeWindow(2);
    ctx.tree.createNode(innerCon.nodeValue, NODE_TYPES.WINDOW, w0);
    ctx.tree.createNode(innerCon.nodeValue, NODE_TYPES.WINDOW, w1);
    ctx.tree.createNode(outer.nodeValue, NODE_TYPES.WINDOW, w2);

    const snapshot = ctx.tree.snapshotLayoutGroups();
    flattenUnderMonitor(monitor, [w0, w2]); // w1 closed during suspend
    ctx.tree.restoreLayoutGroups(snapshot);

    // Inner HSPLIT had a single survivor (w0) -> collapsed; outer STACKED wraps
    // w0 and w2 directly as windows, with no empty/degenerate inner container.
    const stacked = ctx.tree.getNodeByLayout(LAYOUT_TYPES.STACKED);
    expect(stacked).toHaveLength(1);
    expect(stacked[0].childNodes.every((n) => n.isWindow())).toBe(true);
    expect(stacked[0].childNodes.map((n) => n.nodeValue)).toEqual([w0, w2]);
  });

  it("leaves a plain HSPLIT split untouched (nothing to snapshot)", () => {
    buildGroup(LAYOUT_TYPES.HSPLIT, 2);
    expect(ctx.tree.snapshotLayoutGroups()).toHaveLength(0);
  });
});
