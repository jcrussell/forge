import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createTreeFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
  finalizeActor,
} from "../mocks/helpers/index.js";

/**
 * Bug #5 (forge), the STACKED analog of forge-gdsz, COUPLED with Bug #3.
 *
 * A STACKED CON now owns its child windows' tab actors in its decoration, exactly
 * like a TABBED CON. cleanTree's flatten loop nulls each surviving grandchild's
 * .tab/._tabRep BEFORE removeChild() so _createWindowTab rebuilds a fresh tab —
 * but it only did so when `child.isTabbed()`. Once Bug #3 makes removeChild()
 * destroy a STACKED con's decoration children too, flattening a nested STACKED
 * con destroys the surviving grandchildren's tab actors while node.tab still
 * points at them → dangling actor → the next render throws on the deallocated
 * St.BoxLayout. The flatten heal-tab gate must therefore use isStackedOrTabbed().
 *
 * This test is the guard that Bug #3 (removeChild destroys the stacked decoration)
 * and Bug #5 (flatten nulls surviving stacked tabs first) stay coupled.
 */
describe("Bug #5: flatten of a nested STACKED con keeps surviving windows' tabs valid", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
  });

  it("nulls surviving windows' tabs so they rebuild and the next render is safe", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;

    // Build the single-child-nesting that cleanTree flattens:
    //   monitor -> outerCON -> stackedCON[W1, W2]
    const outerCon = createContainerNode(monitor, LAYOUT_TYPES.HSPLIT, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const stackedCon = createContainerNode(outerCon, LAYOUT_TYPES.STACKED, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const w1 = createWindowNode(ctx.tree, stackedCon).nodeWindow;
    const w2 = createWindowNode(ctx.tree, stackedCon).nodeWindow;

    // Simulate what render does: parent each window's tab into the stacked CON's
    // decoration, and make the actor throw once "deallocated" (destroyed) — this
    // is the St.BoxLayout-already-deallocated behavior the real bug hit.
    [w1, w2].forEach((w) => {
      expect(w.tab).toBeTruthy();
      stackedCon.decoration.add_child(w.tab);
      w.tab.destroy = () => finalizeActor(w.tab);
    });

    const t1 = w1.tab;
    const t2 = w2.tab;

    // Flatten: outerCON has a single CON child, so cleanTree collapses it. With
    // Bug #3 fixed, removeChild(stackedCON) destroys the decoration's children —
    // so the flatten MUST have nulled w1/w2's tabs first (Bug #5) or the next
    // render throws on a dead actor.
    ctx.tree.cleanTree();

    // Both windows survive, reparented up to outerCon.
    expect(outerCon.childNodes).toContain(w1);
    expect(outerCon.childNodes).toContain(w2);

    // Their original (now-destroyed) tab references must be cleared so the next
    // render rebuilds fresh tabs instead of touching deallocated actors.
    expect(w1.tab).not.toBe(t1);
    expect(w2.tab).not.toBe(t2);
    expect(w1.tab).toBeTruthy();
    expect(w2.tab).toBeTruthy();

    // A subsequent render touches each window's tab (Node.render reads
    // tab.get_child_at_index(1)) — it must not throw on a dead actor.
    expect(() => ctx.tree.processNode(ctx.tree)).not.toThrow();
    expect(() => w1.render()).not.toThrow();
    expect(() => w2.render()).not.toThrow();
  });
});
