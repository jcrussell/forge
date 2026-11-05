import { describe, it, expect, afterEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * Bug forge-in5v: cleanTree's flatten collapsed any container whose only child is
 * a container and adopted the child's layout. Closing W1 in
 * STACKED[W1, HSPLIT[W2, W3]] turned the stack into a plain HSPLIT, and with
 * auto-exit-tabbed off TABBED[W1, CON[W2, W3]] was un-grouped on the next render.
 *
 * Fix: the flatten keeps a stacked/tabbed group whose only child is a split; a
 * redundant group-in-group still collapses into one tab bar.
 */
describe("Bug forge-in5v: flatten keeps a stacked/tabbed group around a lone split", () => {
  let ctx;

  afterEach(() => ctx.cleanup());

  function tileWin(id) {
    const node = new Node(NODE_TYPES.WINDOW, createMockWindow({ id }));
    node.settings = ctx.tree.settings;
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  function con(layout) {
    const node = new Node(NODE_TYPES.CON, new Bin());
    node.settings = ctx.tree.settings;
    node.layout = layout;
    return node;
  }

  it.each([
    ["STACKED", true],
    ["TABBED", false],
  ])("%s[W1, HSPLIT[W2, W3]] stays grouped after W1 closes", (layout, autoExitTabbed) => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "auto-exit-tabbed": autoExitTabbed },
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const group = con(LAYOUT_TYPES[layout]);
    monitor.appendChild(group);
    const w1 = tileWin(8101);
    group.appendChild(w1);
    const split = con(LAYOUT_TYPES.HSPLIT);
    group.appendChild(split);
    split.appendChild(tileWin(8102));
    split.appendChild(tileWin(8103));

    ctx.tree.removeNode(w1);
    ctx.tree.cleanTree();

    expect(group.layout).toBe(LAYOUT_TYPES[layout]);
    expect(group.childNodes).toEqual([split]);
    expect(split.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });

  it.each([
    ["STACKED", true],
    ["TABBED", false],
  ])(
    "%s[W1, same[W2, W3]] still collapses to one group after W1 closes",
    (layout, autoExitTabbed) => {
      ctx = createTreeFixture({
        fullExtWm: true,
        settings: { "auto-exit-tabbed": autoExitTabbed },
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const outer = con(LAYOUT_TYPES[layout]);
      monitor.appendChild(outer);
      const w1 = tileWin(8201);
      outer.appendChild(w1);
      const inner = con(LAYOUT_TYPES[layout]);
      outer.appendChild(inner);
      const w2 = tileWin(8202);
      const w3 = tileWin(8203);
      inner.appendChild(w2);
      inner.appendChild(w3);

      ctx.tree.removeNode(w1);
      ctx.tree.cleanTree();

      expect(outer.layout).toBe(LAYOUT_TYPES[layout]);
      expect(outer.childNodes).toEqual([w2, w3]);
    }
  );
});
