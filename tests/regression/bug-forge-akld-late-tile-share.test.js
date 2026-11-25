import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * A window that does not tile when it is created (a Wayland window has no title
 * yet, or its workspace is not tiling) got no share of its container; when it
 * tiled later it sat beside resized siblings with no share and came out too
 * narrow.
 */
describe("a window that tiles after it was created gets a fair share", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  function resizedPair() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    return [0.7, 0.3].map((percent, i) => {
      const win = createMockWindow({ wm_class: "App", id: 100 + i, title: `w${i}` });
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      node.mode = WINDOW_MODES.TILE;
      node.percent = percent;
      return node;
    });
  }

  it("when its title arrives after creation", () => {
    const [wide, narrow] = resizedPair();
    const late = createMockWindow({ wm_class: "App", id: 103, title: "" });
    ctx.windowManager.trackWindow(null, late);
    const node = ctx.windowManager.findNodeWindow(late);
    expect(node.percent).toBe(0);

    late.title = "ready";
    ctx.windowManager.processFloats();

    expect(node.percent).toBeCloseTo(1 / 3);
    expect(wide.percent + narrow.percent + node.percent).toBeCloseTo(1);
    expect(wide.percent / narrow.percent).toBeCloseTo(0.7 / 0.3);
  });

  it("when it was opened while its workspace was not tiling", () => {
    const [wide, narrow] = resizedPair();
    const tiled = vi.spyOn(ctx.windowManager, "isActiveWindowWorkspaceTiled");
    tiled.mockReturnValue(false);
    ctx.windowManager.processFloats();
    expect(wide.mode).toBe(WINDOW_MODES.FLOAT);
    const late = createMockWindow({ wm_class: "App", id: 105, title: "late" });
    ctx.windowManager.trackWindow(null, late);
    const node = ctx.windowManager.findNodeWindow(late);

    tiled.mockReturnValue(true);
    ctx.windowManager.processFloats();

    expect(node.percent).toBeCloseTo(1 / 3);
    expect(wide.percent + narrow.percent + node.percent).toBeCloseTo(1);
    vi.restoreAllMocks();
  });

  it("when the siblings after it tile in the same pass", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const tiled = vi.spyOn(ctx.windowManager, "isActiveWindowWorkspaceTiled");
    tiled.mockReturnValue(false);
    const sibling = (percent, id) => {
      const win = createMockWindow({ wm_class: "App", id, title: `w${id}` });
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      node.percent = percent;
      return node;
    };
    const wide = sibling(0.7, 110);
    const late = createMockWindow({ wm_class: "App", id: 111, title: "late" });
    ctx.windowManager.trackWindow(null, late);
    const node = ctx.windowManager.findNodeWindow(late);
    const narrow = sibling(0.3, 112);
    expect(monitor.childNodes.indexOf(node)).toBeLessThan(monitor.childNodes.indexOf(narrow));
    ctx.windowManager.processFloats();
    expect(narrow.mode).toBe(WINDOW_MODES.FLOAT);

    tiled.mockReturnValue(true);
    ctx.windowManager.processFloats();

    expect(node.percent).toBeCloseTo(1 / 3);
    expect(wide.percent + narrow.percent + node.percent).toBeCloseTo(1);
    expect(wide.percent / narrow.percent).toBeCloseTo(0.7 / 0.3);
    vi.restoreAllMocks();
  });

  it("only once", () => {
    resizedPair();
    const late = createMockWindow({ wm_class: "App", id: 104, title: "" });
    ctx.windowManager.trackWindow(null, late);
    const node = ctx.windowManager.findNodeWindow(late);
    late.title = "ready";
    ctx.windowManager.processFloats();
    node.percent = 0.5;

    ctx.windowManager.processFloats();

    expect(node.percent).toBe(0.5);
  });
});
