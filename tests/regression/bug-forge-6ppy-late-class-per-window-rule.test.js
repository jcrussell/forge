import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-6ppy: Super+c on a window with no class writes a per-window rule with
 * no class. Once the app reports its class, both toggles must still remove that
 * rule, or the window stays tiled under both.
 */
describe("forge-6ppy: per-window rule written before the window's class arrived", () => {
  let ctx;
  const CLASS_TOGGLE = { name: "FloatClassToggle" };
  const WINDOW_TOGGLE = { name: "FloatToggle" };

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    ctx.configMgr.loadDefaultWindowConfigContents = () => ({ overrides: [] });
    ctx.configMgr.windowProps = { overrides: [] };
    ctx.windowManager.windowProps = ctx.configMgr.windowProps;
  });

  afterEach(() => ctx.cleanup());

  const overrides = () => ctx.configMgr.windowProps.overrides;
  const isFloating = (win) => ctx.windowManager.isFloatingExempt(win);

  function classlessWindow(id) {
    const win = createMockWindow({ wm_class: null, id, title: "Main", allows_resize: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.FLOAT;
    return win;
  }

  it.each([WINDOW_TOGGLE, CLASS_TOGGLE])(
    "$name floats the window once its class arrives, replacing the class-less rule",
    (action) => {
      const win = classlessWindow(1);
      expect(isFloating(win)).toBe(true);

      ctx.windowManager.toggleFloatingMode(WINDOW_TOGGLE, win);
      expect(isFloating(win)).toBe(false);
      expect(overrides()).toEqual([{ wmClass: null, wmId: 1, mode: "tile" }]);

      win.set_wm_class("anki");
      ctx.windowManager.toggleFloatingMode(action, win);
      expect(isFloating(win)).toBe(true);
      expect(overrides()).toEqual([{ wmClass: "anki", wmId: 1, mode: "float" }]);
    }
  );
});
