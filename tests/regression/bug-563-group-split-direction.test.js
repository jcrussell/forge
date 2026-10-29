import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-ext/forge#563: a split container made tabbed or stacked and back went
 * back to a direction taken from the monitor's shape, not the one it had.
 */
describe("Bug #563: tabbed and stacked groups go back to their split direction", () => {
  let ctx;
  let con;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, null);
  });

  it("remembers the split direction a group had", () => {
    con.layout = LAYOUT_TYPES.VSPLIT;
    con.layout = LAYOUT_TYPES.TABBED;
    con.layout = LAYOUT_TYPES.STACKED; // switching between group kinds keeps it
    con.restoreSplitLayout(LAYOUT_TYPES.HSPLIT);
    expect(con.layout).toBe(LAYOUT_TYPES.VSPLIT);
  });

  it("falls back for a container created as a group", () => {
    con.layout = LAYOUT_TYPES.VSPLIT;
    con.setGroupLayout(LAYOUT_TYPES.TABBED, false);
    con.restoreSplitLayout(LAYOUT_TYPES.HSPLIT);
    expect(con.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });
});

/**
 * forge-ext/forge#526: the split-direction toggle only swapped HSPLIT and VSPLIT,
 * so on a window in a tabbed or stacked group it silently did nothing. It now
 * turns the group back into the split it was.
 */
describe("Bug #526: LayoutToggle on a tabbed or stacked group", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "tabbed-tiling-mode-enabled": true },
    });
  });

  afterEach(() => ctx.cleanup());

  it.each([LAYOUT_TYPES.TABBED, LAYOUT_TYPES.STACKED])(
    "turns a %s group back into its split direction",
    (group) => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
      con.layout = LAYOUT_TYPES.VSPLIT;
      const nodes = ["A", "B"].map((id) => {
        const node = ctx.tree.createNode(
          con.nodeValue,
          NODE_TYPES.WINDOW,
          createMockWindow({ id })
        );
        node.mode = WINDOW_MODES.TILE;
        return node;
      });
      con.layout = group;
      ctx.display.get_focus_window.mockReturnValue(nodes[0].nodeValue);
      vi.spyOn(ctx.windowManager, "renderTree").mockImplementation(() => {});

      ctx.windowManager.command({ name: "LayoutToggle" });

      expect(con.layout).toBe(LAYOUT_TYPES.VSPLIT);
    }
  );
});
