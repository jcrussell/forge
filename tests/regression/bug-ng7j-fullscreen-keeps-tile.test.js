import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * forge-ng7j: a fullscreen window keeps its tile, as in i3. Mutter clears the
 * `resizeable` property for every fullscreen window, so reading it as "fixed
 * size" floated the window for the duration of fullscreen and reflowed its
 * neighbours behind it.
 */
describe("a fullscreen window keeps its tile", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
  });

  afterEach(() => ctx.cleanup());

  function tileWindow(monitor, id) {
    const metaWindow = createMockWindow({
      id,
      wm_class: "org.gnome.TextEditor",
      title: "Notes",
      rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
      workspace: ctx.workspaces[0],
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return { metaWindow, node };
  }

  it("does not float-exempt a resizable window because it is fullscreen", () => {
    const metaWindow = createMockWindow({ wm_class: "org.gnome.TextEditor", title: "Notes" });
    metaWindow.make_fullscreen();

    expect(metaWindow.resizeable).toBe(false);
    expect(ctx.windowManager.isFloatingExempt(metaWindow)).toBe(false);
  });

  it("keeps a tiled window tiled while it is fullscreen", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    tileWindow(monitor, 9301);
    const { metaWindow, node } = tileWindow(monitor, 9302);
    metaWindow.make_fullscreen();

    ctx.windowManager.processFloats();

    expect(node.mode).toBe(WINDOW_MODES.TILE);
  });
});
