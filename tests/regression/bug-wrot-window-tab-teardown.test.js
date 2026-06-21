import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createTreeFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-wrot: removeChild tore down the header tab only for CON nodes, but
 * every WINDOW in a stacked/tabbed CON also owns a `tab` St.BoxLayout
 * (_createWindowTab). Closing a window inside a 2+-tab container detached the
 * window node without destroying its tab, leaking the BoxLayout + its buttons +
 * signal handlers per close.
 *
 * Bug forge-5r0j: _destroyTab guarded on `this.tab._destroyed`, a flag Forge
 * never set — so the guard was vacuous and a second teardown (e.g. the parent
 * decoration's destroy_all_children already finalized the actor) threw
 * "already deallocated". The two ship together: forge-wrot makes removeChild
 * call _destroyTab on window tabs that the flatten path may already have torn
 * down, so _destroyTab MUST be idempotent.
 */
describe("Bug forge-wrot/forge-5r0j: window tab teardown on removeChild, idempotently", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
  });

  it("destroys a removed WINDOW node's tab actor (forge-wrot)", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const tabbedCon = createContainerNode(monitor, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    createWindowNode(ctx.tree, tabbedCon); // sibling so the CON isn't single-child
    const w1 = createWindowNode(ctx.tree, tabbedCon).nodeWindow;

    expect(w1.tab).toBeTruthy();
    const tab = w1.tab;
    let destroyed = 0;
    const realDestroy = tab.destroy.bind(tab);
    tab.destroy = () => {
      destroyed++;
      realDestroy();
    };

    tabbedCon.removeChild(w1);

    expect(destroyed).toBe(1);
    expect(w1.tab).toBe(null);
  });

  it("_destroyTab is idempotent on an already-finalized tab actor (forge-5r0j)", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const tabbedCon = createContainerNode(monitor, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const w1 = createWindowNode(ctx.tree, tabbedCon).nodeWindow;
    const tab = w1.tab;
    expect(tab).toBeTruthy();

    // Simulate the actor being finalized out from under the node (the parent
    // decoration's destroy_all_children path): later touches throw.
    tab._dead = false;
    tab.destroy = () => {
      tab._dead = true;
    };
    tab.get_parent = () => {
      if (tab._dead) throw new Error("St.BoxLayout has been already deallocated");
      return null;
    };
    tab.destroy(); // first teardown finalizes the actor

    expect(() => w1._destroyTab()).not.toThrow();
    expect(w1.tab).toBe(null);
  });
});
