import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { createTreeFixture } from "../mocks/helpers/index.js";

/**
 * forge-h6jc: the tree scaffold actors (root bin + per-workspace actorBins +
 * per-monitor actorBins) were added to global.window_group but never removed on
 * disable() or Tree.reload(). reload() recreated a new generation of
 * workspace/monitor bins without removing the old one, so every reload leaked a
 * full set of St.Bins. Tree.destroy() (and reload()'s pre-init teardown) now
 * remove the current generation.
 */
describe("forge-h6jc: tree scaffold bin leak", () => {
  let ctx;

  // Count scaffold bins (root + workspace + monitor) currently parented in the
  // mock window_group.
  const scaffoldBins = () => {
    const root = ctx.tree.nodeValue;
    const bins = [root];
    for (const ws of ctx.tree.getNodeByType(NODE_TYPES.WORKSPACE)) bins.push(ws.actorBin);
    for (const mon of ctx.tree.getNodeByType(NODE_TYPES.MONITOR)) bins.push(mon.actorBin);
    return bins.filter((bin) => bin && ctx.windowGroup.contains(bin)).length;
  };

  beforeEach(() => {
    ctx = createTreeFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("removes every scaffold bin from window_group on destroy()", () => {
    // Constructor added rootBin + workspace + monitor bins.
    expect(scaffoldBins()).toBeGreaterThan(0);
    const groupBefore = ctx.windowGroup._children.length;
    const scaffoldCount = scaffoldBins();

    ctx.tree.destroy();

    expect(ctx.windowGroup._children.length).toBe(groupBefore - scaffoldCount);
  });

  it("does not accumulate bins across repeated reload()s", () => {
    const baseline = ctx.windowGroup._children.length;

    ctx.tree.reload();
    const afterFirst = ctx.windowGroup._children.length;

    ctx.tree.reload();
    const afterSecond = ctx.windowGroup._children.length;

    // The old generation must be torn down before the new one is built, so the
    // child count stays flat instead of growing each reload.
    expect(afterFirst).toBe(baseline);
    expect(afterSecond).toBe(baseline);
  });
});
