import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createTreeFixture,
  getWorkspaceAndMonitor,
  getMonitors,
  createWindowNode,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-6asv: reparenting an intact stacked/tabbed CON destroyed its direct
 * children's still-referenced tab actors without clearing the dangling refs.
 *
 * window.js:_rehomeWindowPreservingContainer moves a whole sub-tree with
 * destNode.appendChild(nodeToMove). When nodeToMove is a stacked/tabbed CON,
 * appendChild -> removeChild reaches the `node.isStackedOrTabbed() && node.decoration`
 * block, whose decoration.destroy_all_children() finalizes the tab St.BoxLayout
 * actors of the CON's DIRECT children. Those children migrate INSIDE the CON and
 * survive the move, so their node.tab then dangled and the next render threw on
 * the deallocated actor (tree.js render(): this.tab.get_child_at_index(1)).
 *
 * Fix (mirrors the forge-gdsz flatten guard via the shared _resetTabForReparent
 * helper): null each direct child's .tab/._tabRep and rebuild BEFORE the destroy,
 * so _createWindowTab (WINDOW) / _ensureConTab (CON) regenerate fresh tabs. Direct
 * children only — nested CON decorations are untouched and stay live.
 */
describe("Bug forge-6asv: reparenting a tabbed CON does not leave its children with a destroyed tab", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
  });

  // Inject the "St.BoxLayout already deallocated" behavior onto a tab actor:
  // destroy() flips a _dead flag (St mock's destroy_all_children() calls
  // destroy() on each child), and get_child_at_index throws while _dead.
  const injectDeallocThrow = (tab) => {
    const realGet = tab.get_child_at_index.bind(tab);
    tab.destroy = () => {
      tab._dead = true;
    };
    tab.get_child_at_index = (i) => {
      if (tab._dead) throw new Error("St.BoxLayout has been already deallocated");
      return realGet(i);
    };
  };

  it("nulls direct WINDOW children's tabs so they rebuild and the next render is safe", () => {
    const monitors = getMonitors(ctx);
    const srcMon = monitors[0];
    srcMon.layout = LAYOUT_TYPES.HSPLIT;

    // Destination: a sibling CON on the same monitor that fully receives the move.
    const destNode = createContainerNode(srcMon, LAYOUT_TYPES.HSPLIT, {
      x: 800,
      y: 0,
      width: 800,
      height: 600,
    });

    // Source: an intact TABBED CON with two window children.
    const tabbedCon = createContainerNode(srcMon, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const w1 = createWindowNode(ctx.tree, tabbedCon).nodeWindow;
    const w2 = createWindowNode(ctx.tree, tabbedCon).nodeWindow;

    // Render-equivalent: parent each window's tab into the tabbed CON's decoration
    // and make the actor throw once destroyed (the real St.BoxLayout behavior).
    [w1, w2].forEach((w) => {
      expect(w.tab).toBeTruthy();
      tabbedCon.decoration.add_child(w.tab);
      injectDeallocThrow(w.tab);
    });

    const t1 = w1.tab;
    const t2 = w2.tab;

    // Reparent the intact tabbed CON — drives removeChild's decoration-destroy path.
    destNode.appendChild(tabbedCon);

    // The whole CON moved; its windows survived inside it under destNode.
    expect(destNode.childNodes).toContain(tabbedCon);
    expect(tabbedCon.childNodes).toContain(w1);
    expect(tabbedCon.childNodes).toContain(w2);

    // Their original (now-destroyed) tab refs must be replaced with fresh actors.
    expect(w1.tab).toBeTruthy();
    expect(w1.tab).not.toBe(t1);
    expect(w2.tab).toBeTruthy();
    expect(w2.tab).not.toBe(t2);

    // A subsequent render must not touch a deallocated actor.
    expect(() => w1.render()).not.toThrow();
    expect(() => w2.render()).not.toThrow();
    expect(() => ctx.tree.processNode(ctx.tree)).not.toThrow();
  });

  it("clears a direct CON child's _tabRep so its header tab rebuilds (nested split)", () => {
    const monitors = getMonitors(ctx);
    const srcMon = monitors[0];
    srcMon.layout = LAYOUT_TYPES.HSPLIT;

    const destNode = createContainerNode(srcMon, LAYOUT_TYPES.HSPLIT, {
      x: 800,
      y: 0,
      width: 800,
      height: 600,
    });

    // Source: TABBED CON whose direct children are a WINDOW and an inner split CON.
    const tabbedCon = createContainerNode(srcMon, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const w1 = createWindowNode(ctx.tree, tabbedCon).nodeWindow;
    const innerCon = createContainerNode(tabbedCon, LAYOUT_TYPES.HSPLIT, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const wInner = createWindowNode(ctx.tree, innerCon).nodeWindow;

    // Build the direct CON child's header tab (normally done in processNode).
    innerCon._ensureConTab();
    expect(innerCon.tab).toBeTruthy();
    expect(innerCon._tabRep).toBe(wInner);

    // Parent direct children's tabs into the tabbed CON's decoration; inject throw.
    [w1, innerCon].forEach((n) => {
      tabbedCon.decoration.add_child(n.tab);
      injectDeallocThrow(n.tab);
    });

    const t1 = w1.tab;
    const tInner = innerCon.tab;

    destNode.appendChild(tabbedCon);

    // The inner CON survived inside the moved tabbed CON; its dead header tab ref
    // and _tabRep must be cleared so _ensureConTab rebuilds rather than early
    // -returning on `this.tab && this._tabRep === rep` over a deallocated actor.
    expect(innerCon.tab).toBe(null);
    expect(innerCon._tabRep).toBe(null);
    expect(w1.tab).not.toBe(t1);

    // The inner window (a grandchild) is NOT a direct child of the tabbed CON, so
    // its tab is untouched and still live.
    expect(wInner.tab).toBeTruthy();

    // Re-rendering rebuilds the inner CON's header tab fresh.
    tabbedCon.layout = LAYOUT_TYPES.TABBED;
    innerCon._ensureConTab();
    expect(innerCon.tab).toBeTruthy();
    expect(innerCon.tab).not.toBe(tInner);

    expect(() => ctx.tree.processNode(ctx.tree)).not.toThrow();
  });
});
