import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-eycu: a float toggle press tries its steps on an in-memory copy of the
 * rules and writes windows.json once at the end, only when the rules changed.
 * A press that changes nothing leaves the file alone, so hand-edited entries
 * aren't reformatted and malformed ones aren't dropped.
 */
describe("forge-eycu: a float toggle press writes windows.json at most once", () => {
  let ctx;
  let disk;
  let writes;
  const CLASS_TOGGLE = { name: "FloatClassToggle" };
  const WINDOW_TOGGLE = { name: "FloatToggle" };

  // Each read returns a fresh copy and each write replaces the store, like the file.
  function installDisk(overrides) {
    disk = structuredClone(overrides);
    writes = 0;
    ctx.windowManager.ext.configMgr = {
      get windowProps() {
        return { overrides: structuredClone(disk) };
      },
      set windowProps(props) {
        writes++;
        disk = structuredClone(props.overrides);
      },
      loadDefaultWindowConfigContents: () => ({ overrides: [] }),
    };
    ctx.windowManager.windowProps = ctx.windowManager.ext.configMgr.windowProps;
  }

  function tiledWindow(wmClass, id, title) {
    const win = createMockWindow({ wm_class: wmClass, id, title, allows_resize: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return win;
  }

  const isFloating = (win) => ctx.windowManager.isFloatingExempt(win);

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it.each([WINDOW_TOGGLE, CLASS_TOGGLE])("$name that changes nothing writes nothing", (action) => {
    const start = [
      { wmClass: "gedit", wmTitle: "Notes", mode: "tile" },
      { wmClass: "gedit", mode: "float" },
    ];
    installDisk(start);
    const win = tiledWindow("gedit", 1, "Notes - gedit");

    ctx.windowManager.toggleFloatingMode(action, win);

    expect(isFloating(win)).toBe(false);
    expect(disk).toEqual(start);
    expect(writes).toBe(0);
  });

  it("decides from the rules on disk, not a stale cache", () => {
    installDisk([{ wmClass: "gedit", mode: "float" }]);
    const win = tiledWindow("gedit", 3, "Main");
    // Another writer (prefs) changed the file without refreshing the cache.
    ctx.windowManager.windowProps = { overrides: [] };

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);

    expect(isFloating(win)).toBe(false);
    expect(disk).toEqual([]);
  });

  it("writes nothing and keeps the rules when a step throws", () => {
    const start = [{ wmClass: "gedit", mode: "float" }];
    installDisk(start);
    const win = tiledWindow("gedit", 4, "Main");
    ctx.windowManager._toggleModeOverride = () => {
      ctx.windowManager._pendingWindowProps.overrides = [];
      throw new Error("boom");
    };

    expect(() => ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win)).toThrow("boom");
    expect(writes).toBe(0);
    expect(ctx.windowManager.windowProps.overrides).toEqual(start);
    expect(ctx.windowManager._pendingWindowProps).toBeNull();
  });

  it.each([WINDOW_TOGGLE, CLASS_TOGGLE])("$name that flips the window writes once", (action) => {
    installDisk([]);
    const win = tiledWindow("gedit", 2, "Main");

    ctx.windowManager.toggleFloatingMode(action, win);
    expect(isFloating(win)).toBe(true);
    expect(writes).toBe(1);

    ctx.windowManager.toggleFloatingMode(action, win);
    expect(isFloating(win)).toBe(false);
    expect(disk).toEqual([]);
    expect(writes).toBe(2);
  });

  it("writes once when the class toggle falls back to a per-window rule", () => {
    const start = [{ wmClass: "firefox", wmTitle: "!Mozilla Firefox", mode: "float" }];
    installDisk(start);
    const win = tiledWindow("firefox", 3, "Picture-in-Picture");
    expect(isFloating(win)).toBe(true);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(false);
    expect(writes).toBe(1);

    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(isFloating(win)).toBe(true);
    expect(disk).toEqual(start);
    expect(writes).toBe(2);
  });
});
