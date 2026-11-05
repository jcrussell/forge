import { describe, it, expect, afterEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * Bug forge-tlhk: every CON creates its decoration St.BoxLayout in
 * global.window_group, but removeChild only destroys it for a stacked/tabbed CON.
 * cleanTree's flatten and toggleWorkspaceMonocle's prune drop split CONs from the
 * tree for good with a raw removeChild, so their decorations stayed in
 * window_group until reload/disable.
 *
 * Fix: both paths tear the removed CON down via _forgetRemoved.
 */
describe("Bug forge-tlhk: removed split containers release their decorations", () => {
  let ctx;

  afterEach(() => ctx.cleanup());

  const decorations = () =>
    global.window_group.get_children().filter((a) => a.type === "forge-deco");

  const expectNoLeak = (tree, gone) => {
    expect(decorations()).toHaveLength(tree.getNodeByType(NODE_TYPES.CON).length);
    expect(global.window_group.contains(gone)).toBe(false);
  };

  function tileWin(id) {
    const node = new Node(
      NODE_TYPES.WINDOW,
      createMockWindow({ id, workspace: ctx.workspaces[0] })
    );
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

  it("cleanTree flatten destroys the flattened container's decoration", () => {
    ctx = createTreeFixture({ fullExtWm: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);

    // [A:HSPLIT[W1, B:VSPLIT[W2, W3]]], close W1 → B is flattened into A.
    const a = con(LAYOUT_TYPES.HSPLIT);
    monitor.appendChild(a);
    const w1 = tileWin(7101);
    a.appendChild(w1);
    const b = con(LAYOUT_TYPES.VSPLIT);
    a.appendChild(b);
    b.appendChild(tileWin(7102));
    b.appendChild(tileWin(7103));
    const bDecoration = b.decoration;
    expect(global.window_group.contains(bDecoration)).toBe(true);

    ctx.tree.removeNode(w1);
    ctx.tree.cleanTree();

    expect(a.childNodes.every((c) => c.isWindow())).toBe(true);
    expect(b.decoration).toBeNull();
    expectNoLeak(ctx.tree, bDecoration);
  });

  it("toggleWorkspaceMonocle prune destroys the emptied container's decoration", () => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1200, height: 800 };

    const target = con(LAYOUT_TYPES.VSPLIT);
    monitor.appendChild(target);
    target.appendChild(tileWin(7201));
    const pruned = con(LAYOUT_TYPES.VSPLIT);
    monitor.appendChild(pruned);
    pruned.appendChild(tileWin(7202));
    const prunedDecoration = pruned.decoration;

    ctx.windowManager.toggleWorkspaceMonocle();

    expect(monitor.getNodeByType(NODE_TYPES.CON)).toEqual([target]);
    expect(pruned.decoration).toBeNull();
    expectNoLeak(ctx.tree, prunedDecoration);
  });
});
