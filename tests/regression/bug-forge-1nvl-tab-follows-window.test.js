import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createTreeFixture,
  getMonitors,
  createWindowNode,
  createContainerNode,
  finalizeActor,
} from "../mocks/helpers/index.js";

/**
 * A window moved out of a stacked/tabbed container kept its tab in that
 * container's decoration. When the emptied container was pruned before the next
 * render (monocle gathers every window into one group), the tab was destroyed
 * with it and the window had no tab in the group it joined.
 */
describe("a window that leaves a tab group takes its tab along", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
    ctx.extWm.currentMonWsNode = ctx.tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
  });

  it("keeps the tab alive when the group it left is removed", () => {
    const monitor = getMonitors(ctx)[0];
    const rect = { x: 0, y: 0, width: 800, height: 600 };
    const target = createContainerNode(monitor, LAYOUT_TYPES.TABBED, rect);
    const source = createContainerNode(monitor, LAYOUT_TYPES.STACKED, rect);
    createWindowNode(ctx.tree, target);
    const moved = createWindowNode(ctx.tree, source).nodeWindow;
    const tab = moved.tab;
    source.decoration.add_child(tab);
    // As the real St.BoxLayout: unusable once destroyed
    tab.destroy = () => finalizeActor(tab);

    target.appendChild(moved);
    monitor.removeChild(source);

    expect(moved.tab).toBe(tab);
    expect(() => tab.get_parent()).not.toThrow();
    expect(tab.get_parent()).toBeNull();
  });
});
