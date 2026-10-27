import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * forge-ext/forge#409: with auto-split on, opening a window split the focused
 * window again by its shape, overriding the direction the user had just chosen
 * with Split (Super+V / Super+Z): one window, Super+V, and the next window
 * still opened beside it on a landscape screen. A dialog opening in between
 * also ran auto-split, though it floats.
 */
describe("#409: the next window opens the way the user split", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "auto-split-enabled": true, "tiling-mode-enabled": true },
    });
    wm().renderTree = vi.fn();
    wm().queueEvent = vi.fn();
    wm().postProcessWindow = vi.fn();
  });

  afterEach(() => ctx.cleanup());

  // One landscape window alone on a side-by-side monitor, focused
  function loneWindow() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const a = createMockWindow({
      wm_class: "A",
      id: 1,
      allows_resize: true,
      rect: new Rectangle({ x: 0, y: 0, width: 1920, height: 1040 }),
    });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, a).mode = WINDOW_MODES.TILE;
    ctx.display.get_focus_window.mockReturnValue(a);
    return { monitor, a };
  }

  const open = (id, params = {}) => {
    const w = createMockWindow({
      wm_class: `W${id}`,
      id,
      title: `W${id}`,
      allows_resize: true,
      ...params,
    });
    wm().trackWindow(ctx.display, w);
    return w;
  };

  it("one window, Split vertically, open another: it goes below", () => {
    const { monitor } = loneWindow();

    wm().command({ name: "Split", orientation: "vertical" });
    open(2);

    expect(monitor.layout).toBe(LAYOUT_TYPES.VSPLIT);
  });

  it("a dialog opening in between doesn't use up the choice", () => {
    const { monitor, a } = loneWindow();

    wm().command({ name: "Split", orientation: "vertical" });
    open(3, { transient_for: a });
    open(4);

    expect(monitor.layout).toBe(LAYOUT_TYPES.VSPLIT);
  });

  it("a dialog that becomes transient only once shown doesn't use it up either", () => {
    const { monitor } = loneWindow();

    wm().command({ name: "Split", orientation: "vertical" });
    // On Wayland the dialog has no parent yet when it is tracked; it floats later
    open(6);
    ctx.tree.findNode(ctx.tree.nodeWindows.at(-1).nodeValue).mode = WINDOW_MODES.FLOAT;
    open(7);

    expect(monitor.layout).toBe(LAYOUT_TYPES.VSPLIT);
  });

  it("without a Split, auto-split still goes by the window's shape", () => {
    const { monitor } = loneWindow();
    monitor.layout = LAYOUT_TYPES.VSPLIT;

    open(5);

    expect(monitor.layout).toBe(LAYOUT_TYPES.HSPLIT);
  });
});
