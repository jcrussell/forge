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
 * A maximized window stays tiled. meta_window_allows_resize() is false while a
 * window is maximized, so it cannot be the fixed-size test: with
 * window-maximize-on-single on, the lone window is maximized, and floating it
 * would leave every following window alone, maximized and floated in turn.
 */
describe("a maximized window keeps tiling", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "window-maximize-on-single": true },
    });
  });

  afterEach(() => ctx.cleanup());

  function tileWindow(monitor, id) {
    const metaWindow = createMockWindow({
      id,
      wm_class: "org.gnome.Nautilus",
      title: "Downloads",
      rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 }),
      workspace: ctx.workspaces[0],
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return { metaWindow, node };
  }

  it("does not float-exempt a resizable window because it is maximized", () => {
    const metaWindow = createMockWindow({ wm_class: "org.gnome.Nautilus", title: "Downloads" });
    metaWindow.maximize();

    expect(metaWindow.allows_resize()).toBe(false);
    expect(ctx.windowManager.isFloatingExempt(metaWindow)).toBe(false);
  });

  it("still floats a fixed-size window", () => {
    const metaWindow = createMockWindow({ title: "Fixed", allows_resize: false });

    expect(ctx.windowManager.isFloatingExempt(metaWindow)).toBe(true);
  });

  it("keeps the lone window tiled after maximize-on-single maximizes it", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const { metaWindow, node } = tileWindow(monitor, 9101);

    ctx.windowManager.handleMaximizeOnSingle();
    expect(metaWindow.is_maximized()).toBe(true);

    ctx.windowManager.processFloats();
    expect(node.mode).toBe(WINDOW_MODES.TILE);
  });

  it("tiles a window that opens maximized next to the existing one", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    tileWindow(monitor, 9201);
    const { metaWindow, node } = tileWindow(monitor, 9202);
    metaWindow.maximize();

    ctx.windowManager.processFloats();

    expect(node.mode).toBe(WINDOW_MODES.TILE);
  });
});
