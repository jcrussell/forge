import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";

/**
 * forge-n0s7: two stale-state leaks.
 *
 * (a) The pointer-focus poll loop ends itself by returning false (GLib then
 * destroys the source) without zeroing _pointerFocusTimeoutId, so the next
 * pointerLoopInit() or _removeSignals() called GLib.Source.remove on a dead
 * ID (GLib-CRITICAL log spam).
 *
 * (b) workspaceAdded/workspaceRemoved were only consumed inside
 * _onWorkareasChanged's tree-has-windows branch; a workspace change on an
 * empty tree left the flag set, making the NEXT unrelated workareas-changed
 * take the expensive trackCurrentWindows branch instead of a re-render.
 */
describe("forge-n0s7: source-id and flag hygiene", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("pointer-focus loop zeroes its source ID when it self-terminates", () => {
    const callbacks = [];
    vi.spyOn(GLib, "timeout_add").mockImplementation((priority, interval, cb) => {
      callbacks.push(cb);
      return 42;
    });
    const wm = ctx.windowManager;
    wm.shouldFocusOnHover = true;
    wm.pointerLoopInit();
    expect(wm._pointerFocusTimeoutId).toBe(42);

    // User turns the feature off; the next tick ends the loop.
    wm.shouldFocusOnHover = false;
    const keepPolling = callbacks[callbacks.length - 1]();

    expect(keepPolling).toBe(false);
    expect(wm._pointerFocusTimeoutId).toBe(0);
  });

  it("consumes workspaceAdded even when the tree has no windows", () => {
    const wm = ctx.windowManager;
    const trackSpy = vi.spyOn(wm, "trackCurrentWindows").mockImplementation(() => {});
    const renderSpy = vi.spyOn(wm, "renderTree").mockImplementation(() => {});

    // Workspace added while the tree is empty: nothing to re-track, but the
    // flag must still be consumed.
    wm.workspaceAdded = true;
    wm._onWorkareasChanged(ctx.display);
    expect(wm.workspaceAdded).toBe(false);

    // The next workareas-changed with windows present must take the cheap
    // re-render branch, not trackCurrentWindows.
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const win = createMockWindow({ wm_class: "App" });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;

    wm._onWorkareasChanged(ctx.display);
    expect(trackSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledWith("workareas-changed");
  });

  it("still re-tracks when a workspace changed and windows exist", () => {
    const wm = ctx.windowManager;
    const trackSpy = vi.spyOn(wm, "trackCurrentWindows").mockImplementation(() => {});

    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    const win = createMockWindow({ wm_class: "App" });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;

    wm.workspaceRemoved = true;
    wm._onWorkareasChanged(ctx.display);

    expect(trackSpy).toHaveBeenCalled();
    expect(wm.workspaceRemoved).toBe(false);
  });
});
