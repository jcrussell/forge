import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * forge-s02h: this.lastFocusedWindow stores a tree Node and is dereferenced
 * inside deferred pointer warps via storePointerLastPosition. windowDestroy
 * never cleared it, so after the focused window closed (or its app exited
 * across suspend) lastFocusedWindow pointed at a disposed Meta.Window whose
 * wrapper keeps _data truthy. storePointerLastPosition guarded only
 * `nodeWindow && nodeWindow._data` before calling get_frame_rect(), which
 * throws on a finalized wrapper.
 *
 * Fix: (a) require Utils.isWindowAlive(nodeValue) before touching the frame;
 * (b) clear lastFocusedWindow in windowDestroy when its node closes.
 */
describe("forge-s02h: stale lastFocusedWindow in deferred pointer warp", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const wm = () => ctx.windowManager;
  const workspace0 = () => ctx.workspaces[0];

  function tiledNode(opts = {}) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const win = createMockWindow({
      rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
      workspace: workspace0(),
      ...opts,
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return { win, node };
  }

  it("storePointerLastPosition bails on a disposed window instead of throwing", () => {
    const { win, node } = tiledNode();
    // Disposed GJS wrapper: every method throws, but the Node wrapper still
    // has _data set, mimicking a closed window's lingering lastFocusedWindow.
    const disposed = () => {
      throw new Error("Object Meta.Window (0xdead), has been already deallocated");
    };
    win.get_id = disposed;
    win.get_frame_rect = disposed;

    expect(() => wm().storePointerLastPosition(node)).not.toThrow();
    // The dead window must not get a stored pointer.
    expect(node.pointer).toBeNull();
  });

  it("windowDestroy clears lastFocusedWindow when its node closes", () => {
    const { win, node } = tiledNode();
    wm().lastFocusedWindow = node;

    wm().windowDestroy(win.get_compositor_private());

    expect(wm().lastFocusedWindow).toBeNull();
  });

  it("windowDestroy leaves lastFocusedWindow untouched for a different window", () => {
    const a = tiledNode();
    const b = tiledNode();
    wm().lastFocusedWindow = a.node;

    wm().windowDestroy(b.win.get_compositor_private());

    expect(wm().lastFocusedWindow).toBe(a.node);
  });
});
