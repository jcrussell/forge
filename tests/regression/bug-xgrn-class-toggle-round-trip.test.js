import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-xgrn: Super+Shift+c (FloatClassToggle) sets the app's always-float state;
 * the last press wins for the class. Floating the class removed its class tile
 * rule (often a bundled one, e.g. Evolution), and tiling it again only re-added
 * a tile rule when the window was still float-exempt, so one round trip lost the
 * bundled rule.
 */
describe("forge-xgrn: FloatClassToggle round trip keeps the class tile rule", () => {
  let ctx;
  const CLASS_TOGGLE = { name: "FloatClassToggle" };

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    ctx.configMgr.loadDefaultWindowConfigContents = () => ({
      overrides: [{ wmClass: "evolution", mode: "tile" }],
    });
  });

  afterEach(() => ctx.cleanup());

  const overrides = () => ctx.configMgr.windowProps.overrides;

  function tiledWindow(wmClass, id) {
    const win = createMockWindow({ wm_class: wmClass, id, title: "Main", allows_resize: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return win;
  }

  function setOverrides(list) {
    ctx.configMgr.windowProps = { overrides: list };
    ctx.windowManager.windowProps = ctx.configMgr.windowProps;
  }

  it("puts the class tile rule back after a float/tile round trip", () => {
    setOverrides([{ wmClass: "evolution", mode: "tile" }]);
    const win = tiledWindow("evolution", 1);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(true);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(false);
    expect(overrides()).toEqual([
      expect.objectContaining({ wmClass: "evolution", mode: "tile", wmId: undefined }),
    ]);
  });

  it("leaves no rule after a round trip for an app with no bundled tile rule", () => {
    setOverrides([]);
    const win = tiledWindow("gedit", 4);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(true);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(false);
    expect(overrides()).toEqual([]);
  });

  it("tiles a comma-list app and floats it again without touching its rule", () => {
    const steamRule = { wmClass: "Steam,steam,steamwebhelper", mode: "float" };
    setOverrides([{ ...steamRule }]);
    const win = tiledWindow("steamwebhelper", 2);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(false);
    expect(overrides()).toContainEqual(steamRule);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(true);
    expect(overrides()).toEqual([steamRule]);
    expect(ctx.windowManager.isFloatingExempt(tiledWindow("Steam", 3))).toBe(true);
  });

  it("keeps other windows' per-window rules when the class is toggled", () => {
    const other = { wmClass: "evolution", wmId: 9, mode: "tile" };
    setOverrides([{ wmClass: "evolution", mode: "tile" }, { ...other }]);
    const win = tiledWindow("evolution", 1);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);

    expect(overrides()).toContainEqual(other);
  });
});
