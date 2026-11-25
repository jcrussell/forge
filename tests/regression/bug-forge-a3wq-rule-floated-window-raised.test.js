import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-a3wq: a tiled window that a rule starts to float keeps its frame, and
 * the tiles that take over its space would cover it. processFloats raises it,
 * and keeps a focused float on top.
 */
describe("forge-a3wq: a window a rule newly floats is raised above the tiles", () => {
  let ctx;
  let raised;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    raised = [];
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  function window(wmClass, id, mode = WINDOW_MODES.TILE) {
    const win = createMockWindow({ wm_class: wmClass, id, title: `${wmClass} ${id}` });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = mode;
    vi.spyOn(win, "raise").mockImplementation(() => raised.push(id));
    return { win, node };
  }

  const floatClass = (wmClass) => {
    ctx.windowManager.windowProps = { overrides: [{ wmClass, mode: "float" }] };
  };

  it("raises the class's other window, then the focused float", () => {
    const focused = window("App", 1, WINDOW_MODES.FLOAT);
    const other = window("App", 2);
    window("Other", 3);
    floatClass("App");
    ctx.display.get_focus_window.mockReturnValue(focused.win);

    ctx.windowManager.processFloats();

    expect(other.node.mode).toBe(WINDOW_MODES.FLOAT);
    expect(raised).toEqual([2, 1]);
  });

  it("raises it above a focused tile", () => {
    window("App", 2);
    const tile = window("Other", 3);
    floatClass("App");
    ctx.display.get_focus_window.mockReturnValue(tile.win);

    ctx.windowManager.processFloats();

    expect(raised).toEqual([2]);
  });

  it("raises nothing once the window floats", () => {
    window("App", 2, WINDOW_MODES.FLOAT);
    floatClass("App");

    ctx.windowManager.processFloats();

    expect(raised).toEqual([]);
  });

  it("raises nothing when the workspace stops tiling", () => {
    window("App", 2);
    vi.spyOn(ctx.windowManager, "isActiveWindowWorkspaceTiled").mockReturnValue(false);

    ctx.windowManager.processFloats();

    expect(raised).toEqual([]);
  });

  it("leaves it under a fullscreen window on its monitor", () => {
    window("App", 2);
    const fullscreen = window("Other", 3);
    fullscreen.win.fullscreen = true;
    floatClass("App");

    ctx.windowManager.processFloats();

    expect(raised).toEqual([]);
  });

  it("leaves a float demoted under a fullscreen window where it is", () => {
    const { node } = window("App", 2);
    node._aboveDemotedForFullscreen = true;
    floatClass("App");

    ctx.windowManager.processFloats();

    expect(raised).toEqual([]);
  });
});
