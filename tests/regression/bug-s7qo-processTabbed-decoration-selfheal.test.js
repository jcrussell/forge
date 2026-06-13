import { describe, it, expect, beforeEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createTreeFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-s7qo: processTabbed's catch nulls node.decoration to "recreate on
 * next render", but _createDecoration was only ever called from the Node
 * constructor — so after a single St/Clutter throw during a tab-bar update the
 * decoration was gone for the rest of the session (an orphaned, unhideable bar).
 *
 * The fix self-heals at the top of processTabbed: if node.decoration is null it
 * is rebuilt before use, and re-added to global.window_group.
 */
describe("Bug forge-s7qo: processTabbed recreates a nulled decoration", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
  });

  it("nulls the decoration on a throw, then rebuilds it on the next render", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const tabbedCon = createContainerNode(monitor, LAYOUT_TYPES.TABBED, {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    const a = createWindowNode(ctx.tree, tabbedCon);
    const b = createWindowNode(ctx.tree, tabbedCon);

    // A CON builds its decoration in the Node constructor.
    expect(tabbedCon.decoration).toBeTruthy();

    // Force a throw inside the tab loop: make add_child throw once.
    const decoration = tabbedCon.decoration;
    decoration.contains = vi.fn(() => false);
    decoration.add_child = vi.fn(() => {
      throw new Error("simulated St failure");
    });

    const params = { stackedHeight: 24, tiledChildren: [a.nodeWindow, b.nodeWindow] };
    expect(() => ctx.tree.processTabbed(tabbedCon, a.nodeWindow, params, 0)).not.toThrow();

    // The catch nulled the decoration.
    expect(tabbedCon.decoration).toBeNull();

    // Next render must rebuild it (and re-add it to the window group).
    expect(() => ctx.tree.processTabbed(tabbedCon, a.nodeWindow, params, 0)).not.toThrow();
    expect(tabbedCon.decoration).toBeTruthy();
    expect(global.window_group.contains(tabbedCon.decoration)).toBe(true);
  });
});
