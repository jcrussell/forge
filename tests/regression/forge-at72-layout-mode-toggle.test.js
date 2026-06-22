import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-at72: stacked/tabbed default ON, so disabling either mode in prefs is
 * the common opt-out and triggers WindowManager._handleLayoutModeToggle, which
 * rewrites every live STACKED/TABBED container back to a split (and restores
 * them when re-enabled). That path had no coverage. These tests assert the
 * round-trip converts containers without dropping windows or corrupting the
 * tree.
 */
describe("forge-at72: _handleLayoutModeToggle disable/enable round-trip", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "tiling-mode-enabled": true,
        "stacked-tiling-mode-enabled": true,
        "tabbed-tiling-mode-enabled": true,
      },
    });
    // _handleLayoutModeToggle ends with renderTree(); keep it inert so the test
    // targets the tree mutation, not the placement pipeline.
    vi.spyOn(ctx.windowManager, "renderTree").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  // A CON of `layout` with `count` window children under monitor 0/ws 0.
  function buildGroup(layout, count) {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    con.layout = layout;
    const windows = [];
    for (let i = 0; i < count; i++) {
      const meta = createMockWindow({ id: `${layout}-w${i}`, workspace: ctx.workspaces[0] });
      ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, meta);
      windows.push(meta);
    }
    return { con, windows };
  }

  for (const [label, layoutType, settingName] of [
    ["STACKED", LAYOUT_TYPES.STACKED, "stacked-tiling-mode-enabled"],
    ["TABBED", LAYOUT_TYPES.TABBED, "tabbed-tiling-mode-enabled"],
  ]) {
    it(`converts a live ${label} container to a split when disabled, keeping every window`, () => {
      const { con, windows } = buildGroup(layoutType, 3);
      expect(ctx.tree.getNodeByLayout(layoutType)).toHaveLength(1);

      // User disables the mode in prefs.
      ctx.settings.set_boolean(settingName, false);
      wm()._handleLayoutModeToggle(settingName, layoutType);

      // The container is now a split, remembers what it was, and kept its kids.
      expect([LAYOUT_TYPES.HSPLIT, LAYOUT_TYPES.VSPLIT]).toContain(con.layout);
      expect(con.prevLayout).toBe(layoutType);
      expect(ctx.tree.getNodeByLayout(layoutType)).toHaveLength(0);
      expect(con.childNodes).toHaveLength(3);
      expect(con.childNodes.map((n) => n.nodeValue)).toEqual(windows);
    });

    it(`restores the ${label} container when the mode is re-enabled`, () => {
      const { con } = buildGroup(layoutType, 2);

      ctx.settings.set_boolean(settingName, false);
      wm()._handleLayoutModeToggle(settingName, layoutType);
      expect([LAYOUT_TYPES.HSPLIT, LAYOUT_TYPES.VSPLIT]).toContain(con.layout);

      // User re-enables the mode: the split whose prevLayout matches is restored.
      ctx.settings.set_boolean(settingName, true);
      wm()._handleLayoutModeToggle(settingName, layoutType);

      expect(con.layout).toBe(layoutType);
      expect(con.childNodes).toHaveLength(2);
    });
  }
});
