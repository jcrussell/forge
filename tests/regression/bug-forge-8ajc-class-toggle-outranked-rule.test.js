import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-8ajc: a float toggle press flips the focused window, and never leaves
 * behind a rule that didn't change it. When a title or comma-list rule outranks
 * the app-wide rule Super+Shift+c would write, the toggle writes a rule for just
 * the focused window instead; a title tile rule always tiles, so neither toggle
 * floats a window it matches. A press that can't flip the window leaves the
 * rules as they were, including the class rules it tried to replace.
 */
const BUNDLED = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/windows.json"), "utf8")
).overrides;

describe("forge-8ajc: float toggles flip a window an outranking rule decides", () => {
  let ctx;
  const CLASS_TOGGLE = { name: "FloatClassToggle" };
  const WINDOW_TOGGLE = { name: "FloatToggle" };

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    ctx.configMgr.loadDefaultWindowConfigContents = () => ({ overrides: [] });
  });

  afterEach(() => ctx.cleanup());

  const overrides = () => ctx.configMgr.windowProps.overrides;
  const isFloating = (win) => ctx.windowManager.isFloatingExempt(win);

  function tiledWindow(wmClass, id, title) {
    const win = createMockWindow({ wm_class: wmClass, id, title, allows_resize: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return win;
  }

  function setOverrides(list) {
    ctx.configMgr.windowProps = { overrides: list };
    ctx.windowManager.windowProps = ctx.configMgr.windowProps;
  }

  it("tiles a window a title float rule floats, without an app-wide tile rule", () => {
    const start = [{ wmClass: "firefox", wmTitle: "!Mozilla Firefox", mode: "float" }];
    setOverrides(structuredClone(start));
    const win = tiledWindow("firefox", 1, "Picture-in-Picture");
    expect(isFloating(win)).toBe(true);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(false);
    expect(overrides()).not.toContainEqual(
      expect.objectContaining({ wmClass: "firefox", mode: "tile", wmId: undefined })
    );

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(true);
    expect(overrides()).toEqual(start);
  });

  it("floats a window a comma-list tile rule tiles, and tiles it again", () => {
    const start = [{ wmClass: "a,b", mode: "tile" }];
    setOverrides(structuredClone(start));
    const win = tiledWindow("a", 2, "Main");

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(true);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(false);
    expect(overrides()).toEqual(start);
  });

  it.each([WINDOW_TOGGLE, CLASS_TOGGLE])(
    "$name leaves a window a title tile rule tiles tiled, with no stray rule",
    (action) => {
      const start = [{ wmClass: "gedit", wmTitle: "Notes", mode: "tile" }];
      setOverrides(structuredClone(start));
      const win = tiledWindow("gedit", 3, "Notes - gedit");

      ctx.windowManager.toggleFloatingMode(action, win);
      expect(isFloating(win)).toBe(false);
      expect(overrides()).toEqual(start);
    }
  );

  it("keeps the bundled class tile rule across a round trip on a Chrome PiP window", () => {
    ctx.configMgr.loadDefaultWindowConfigContents = () => ({ overrides: structuredClone(BUNDLED) });
    setOverrides(structuredClone(BUNDLED));
    const win = tiledWindow("Google-chrome", 4, "Picture-in-Picture");
    expect(isFloating(win)).toBe(true);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(false);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(true);
    expect(overrides()).toEqual(BUNDLED);
  });

  it("keeps a class float rule it could not replace, and brings the window back", () => {
    const start = [
      { wmClass: "firefox", mode: "float" },
      { wmClass: "firefox", wmTitle: "!Mozilla Firefox", mode: "float" },
    ];
    setOverrides(structuredClone(start));
    const win = tiledWindow("firefox", 5, "Picture-in-Picture");
    const sibling = tiledWindow("firefox", 6, "Page - Mozilla Firefox");

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(false);
    expect(isFloating(sibling)).toBe(true);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(true);
    expect(overrides()).toEqual(start);
  });

  it.each([WINDOW_TOGGLE, CLASS_TOGGLE])(
    "$name on a window it cannot flip leaves the window and the split shares alone",
    (action) => {
      setOverrides([{ wmClass: "gedit", wmTitle: "Notes", mode: "tile" }]);
      const win = tiledWindow("gedit", 8, "Notes - gedit");
      const other = tiledWindow("other", 9, "Other");
      const node = ctx.windowManager.findNodeWindow(win);
      const otherNode = ctx.windowManager.findNodeWindow(other);
      node.percent = 0.7;
      otherNode.percent = 0.3;
      ctx.display.get_focus_window.mockReturnValue(win);
      const move = vi.spyOn(ctx.windowManager, "move");

      ctx.windowManager.command({ ...action, x: 0, y: 0, width: 0.5, height: 0.5 });

      expect(move).not.toHaveBeenCalled();
      expect([node.percent, otherNode.percent]).toEqual([0.7, 0.3]);
      vi.restoreAllMocks();
    }
  );

  it("keeps the class tile rule when a title tile rule keeps the window tiled", () => {
    const start = [
      { wmClass: "gedit", mode: "tile" },
      { wmClass: "gedit", wmTitle: "Notes", mode: "tile" },
    ];
    setOverrides(structuredClone(start));
    const win = tiledWindow("gedit", 7, "Notes - gedit");

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(false);
    expect(overrides()).toEqual(start);
  });
});
