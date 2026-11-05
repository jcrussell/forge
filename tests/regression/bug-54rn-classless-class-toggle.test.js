import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-54rn: Super+Shift+c on a window with no class wrote
 * {wmClass: null, mode: "tile"}, which classification read as a class-only tile
 * rule for every window, so every class float rule stopped applying.
 */
describe("forge-54rn: class toggle on a class-less window", () => {
  let ctx;
  const CLASS_TOGGLE = { name: "FloatClassToggle" };

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  const overrides = () => ctx.configMgr.windowProps.overrides;

  function trackedWindow(wmClass, id) {
    const win = createMockWindow({ wm_class: wmClass, id, title: "Main", allows_resize: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.FLOAT;
    return win;
  }

  function setOverrides(list) {
    ctx.configMgr.windowProps = { overrides: list };
    ctx.windowManager.windowProps = ctx.configMgr.windowProps;
  }

  it("toggles just that window and leaves class float rules working", () => {
    setOverrides([{ wmClass: "Steam,steam,steamwebhelper", mode: "float" }]);
    const classless = trackedWindow(null, 1);
    const steam = trackedWindow("steam", 2);
    expect(ctx.windowManager.isFloatingExempt(classless)).toBe(true);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, classless);

    expect(ctx.windowManager.isFloatingExempt(classless)).toBe(false);
    expect(ctx.windowManager.isFloatingExempt(steam)).toBe(true);
    expect(overrides().every((o) => o.wmClass || o.wmTitle || o.wmId)).toBe(true);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, classless);

    expect(ctx.windowManager.isFloatingExempt(classless)).toBe(true);
    expect(overrides()).toEqual([{ wmClass: "Steam,steam,steamwebhelper", mode: "float" }]);
  });

  it("ignores a criteria-less tile rule already in the file", () => {
    setOverrides([
      { wmClass: null, mode: "tile" },
      { wmClass: "Steam,steam,steamwebhelper", mode: "float" },
    ]);

    expect(ctx.windowManager.isFloatingExempt(trackedWindow("steam", 2))).toBe(true);
  });
});
