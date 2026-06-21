import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture } from "../mocks/helpers/index.js";

/**
 * Bug forge-98sa: addWorkspace -> tree.addMonitor parents one St.Bin per monitor
 * directly into global.window_group (not under the workspace bin). removeWorkspace
 * only detached the WORKSPACE bin, then dropped the subtree from the model — so
 * every MONITOR bin orphaned in window_group with no reference path. With dynamic
 * workspaces, each workspace-removed signal leaked N bins (N = monitor count).
 *
 * Fix: removeWorkspace tears down the workspace bin AND all of that workspace's
 * monitor bins.
 */
describe("Bug forge-98sa: removeWorkspace tears down monitor bins too", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      globals: { workspaceManager: { workspaceCount: 2 }, monitorCount: 2 },
      settings: { "tiling-mode-enabled": true },
    });
  });

  afterEach(() => ctx.cleanup());

  it("removes every monitor bin of the removed workspace from window_group", () => {
    const wg = global.window_group;
    const ws1 = ctx.tree.findNode("ws1");
    expect(ws1).toBeTruthy();

    const monitorBins = ws1.getNodeByType(NODE_TYPES.MONITOR).map((m) => m.actorBin);
    expect(monitorBins.length).toBeGreaterThan(0);
    const wsBin = ws1.actorBin;

    // All scaffold bins of ws1 are parented in window_group before removal.
    [wsBin, ...monitorBins].forEach((bin) => expect(wg.contains(bin)).toBe(true));

    ctx.tree.removeWorkspace(1);

    // None of ws1's bins remain parented — neither the workspace bin nor the
    // monitor bins leak.
    [wsBin, ...monitorBins].forEach((bin) => expect(wg.contains(bin)).toBe(false));
  });

  it("leaves an unrelated workspace's bins intact", () => {
    const wg = global.window_group;
    const ws0 = ctx.tree.findNode("ws0");
    const ws0Bins = [ws0.actorBin, ...ws0.getNodeByType(NODE_TYPES.MONITOR).map((m) => m.actorBin)];

    ctx.tree.removeWorkspace(1);

    ws0Bins.forEach((bin) => expect(wg.contains(bin)).toBe(true));
  });
});
