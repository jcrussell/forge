import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { GrabOp } from "../mocks/gnome/Meta.js";

/**
 * Bug #175 / #529: Drag preview overlay ("red box") stays on screen until shell restart.
 *
 * When focus is lost at grab-end (window destroyed mid-drag, monitor crossing, compositor
 * grab), _handleGrabOpEnd returns early on `!focusMetaWindow` BEFORE releasing the dragged
 * window's previewHint, orphaning the overlay actor permanently.
 */
describe("Bug #175: Drag preview hint is always released at grab-end", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  function makePreviewHint() {
    return { hide: vi.fn(), destroy: vi.fn() };
  }

  function makeGrabbedNode() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.GRAB_TILE;
    node.previewHint = makePreviewHint();
    return node;
  }

  it("releases the dragged window's preview hint even when focus is lost (focusMetaWindow null)", () => {
    const dragged = makeGrabbedNode();
    wm()._draggedNodeWindow = dragged;

    // Default mock: global.display.get_focus_window() returns null -> focusMetaWindow is null.
    expect(wm().focusMetaWindow).toBeNull();

    const hint = dragged.previewHint;
    wm()._handleGrabOpEnd(ctx.display, null, GrabOp.MOVING_UNCONSTRAINED);

    expect(hint.destroy).toHaveBeenCalledTimes(1);
    expect(dragged.previewHint).toBeNull();
    expect(wm()._draggedNodeWindow).toBeNull();
  });

  it("sweeps any leftover preview hint when the extension is disabled mid-drag", () => {
    const dragged = makeGrabbedNode();
    const hint = dragged.previewHint;
    wm()._draggedNodeWindow = dragged;

    wm().disable();

    expect(hint.destroy).toHaveBeenCalledTimes(1);
    expect(dragged.previewHint).toBeNull();
  });
});
