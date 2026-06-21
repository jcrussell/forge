import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createTreeFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-ogmd: the processStacked/processTabbed self-heal catch blocks set
 * node.decoration = null on a render-time throw to force recreation, but never
 * destroyed the existing St.BoxLayout first. _createDecoration's
 * window_group.contains() guard tests the NEW actor (always false), so the old
 * header stayed parented in window_group forever — one orphaned BoxLayout leaked
 * per self-heal.
 *
 * Fix: _destroyDecoration() tears the orphan down (in its own try/catch so a
 * second throw on a finalized actor can't escape the render loop) before nulling.
 */
describe("Bug forge-ogmd: a decoration that throws mid-update is destroyed before recreation", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
  });

  const drives = (layout) => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const con = createContainerNode(monitor, layout, { x: 0, y: 0, width: 800, height: 600 });
    createWindowNode(ctx.tree, con); // single tiled child keeps the CON unflattened here

    // First render lays out the decoration cleanly and creates the actor.
    ctx.tree.processNode(monitor);
    const deco = con.decoration;
    expect(deco).toBeTruthy();

    // Make the next decoration update throw, and watch the orphan teardown.
    let destroyed = 0;
    const realDestroy = deco.destroy.bind(deco);
    deco.destroy = () => {
      destroyed++;
      realDestroy();
    };
    deco.set_size = () => {
      throw new Error("boom: finalized actor");
    };

    expect(() => ctx.tree.processNode(monitor)).not.toThrow();
    return { con, destroyed: () => destroyed };
  };

  it("destroys the orphaned STACKED decoration on a render-time throw", () => {
    const { con, destroyed } = drives(LAYOUT_TYPES.STACKED);
    expect(destroyed()).toBe(1);
    expect(con.decoration).toBe(null);
  });

  it("destroys the orphaned TABBED decoration on a render-time throw", () => {
    const { con, destroyed } = drives(LAYOUT_TYPES.TABBED);
    expect(destroyed()).toBe(1);
    expect(con.decoration).toBe(null);
  });
});
