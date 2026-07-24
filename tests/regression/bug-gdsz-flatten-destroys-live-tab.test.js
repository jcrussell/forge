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
 * Bug forge-gdsz: cleanTree's nested-CON flatten destroyed the tab actors of
 * windows that survive the flatten.
 *
 * A WINDOW node's tab actor is created once and, during render, parented into
 * its TABBED CON's decoration. When cleanTree flattens a single-child CON
 * [outerCON[ tabbedCON[W1,W2] ]], it reparents W1/W2 to outerCON and then calls
 * outerCON.removeChild(tabbedCON) — whose decoration.destroy_all_children()
 * destroyed W1/W2's still-referenced tab actors. node.tab then dangled and every
 * later render threw on the deallocated St.BoxLayout, so tiling stopped updating.
 *
 * Fix: the flatten loop nulls .tab on each surviving (formerly-tabbed) child
 * BEFORE removeChild, so _createWindowTab rebuilds a fresh tab on the next render.
 */
describe("Bug forge-gdsz: flatten does not leave live windows with a destroyed tab", () => {
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
    //   monitor -> outerCON -> tabbedCON[W1, W2]
    const outerCon = createContainerNode(monitor, LAYOUT_TYPES.HSPLIT, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const tabbedCon = createContainerNode(outerCon, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const w1 = createWindowNode(ctx.tree, tabbedCon).nodeWindow;
    const w2 = createWindowNode(ctx.tree, tabbedCon).nodeWindow;

    // Simulate what render does: parent each window's tab into the tabbed CON's
    // decoration, and make the actor throw once "deallocated" (destroyed) — this
    // is the St.BoxLayout-already-deallocated behavior the real bug hit.
    [w1, w2].forEach((w) => {
      expect(w.tab).toBeTruthy();
      tabbedCon.decoration.add_child(w.tab);
      w.tab.destroy = () => finalizeActor(w.tab);
    });

    const t1 = w1.tab;
    const t2 = w2.tab;

    // Flatten: outerCON has a single CON child, so cleanTree collapses it.
    ctx.tree.cleanTree();

    // Both windows survive, reparented up to outerCon.
    expect(outerCon.childNodes).toContain(w1);
    expect(outerCon.childNodes).toContain(w2);

    // Their original (now-destroyed) tab references must be cleared so the next
    // render rebuilds fresh tabs instead of touching deallocated actors.
    expect(w1.tab).not.toBe(t1);
    expect(w2.tab).not.toBe(t2);

    // A subsequent render touches each window's tab (Node.render reads
    // tab.get_child_at_index(1)) — it must not throw on a dead actor.
    expect(() => ctx.tree.processNode(ctx.tree)).not.toThrow();
    expect(() => w1.render()).not.toThrow();
    expect(() => w2.render()).not.toThrow();
  });
});
