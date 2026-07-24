import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  finalizeWindow,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug #328 hardening: disconnectSignals() had no guard, so one
 * disposed/finalized target throwing from disconnect() aborted the whole
 * _removeSignals() loop - every remaining window kept its connections and
 * _signalsBound stayed true, producing the "invalid (NULL) pointer instance /
 * g_signal_handler_disconnect assertion" storm on later disable/destroy
 * passes. A missing target (e.g. global.window_manager already torn down)
 * threw a TypeError with the same effect.
 */
describe("Bug #328: disconnect on destroyed targets must not abort cleanup", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const wm = () => ctx.windowManager;

  function seedSignalState(windows) {
    wm()._signalsBound = true;
    wm()._displaySignals = [];
    wm()._workspaceManagerSignals = [];
    wm()._overviewSignals = [];
    ctx.display.get_tab_list = vi.fn(() => windows);
  }

  it("a disposed window must not abort _removeSignals for remaining windows", () => {
    // metaB is live and reached the normal way (Mutter's get_tab_list never
    // returns finalized windows).
    const metaB = createMockWindow({ workspace: ctx.workspaces[0] });
    metaB.windowSignals = [102];
    seedSignalState([metaB]);
    const disconnectB = vi.spyOn(metaB, "disconnect");

    // A window closed (finalized) while still referenced by a tree WINDOW node —
    // the faithful source of a dead wrapper during disable(). finalizeWindow makes
    // EVERY method throw (disconnect AND get_compositor_private), not just the one
    // the old spy remembered, so _removeSignals' per-window body must survive it.
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const dead = createMockWindow({ id: 9328 });
    dead.windowSignals = [101];
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dead);
    finalizeWindow(dead);

    expect(() => wm()._removeSignals()).not.toThrow();

    expect(disconnectB).toHaveBeenCalledWith(102);
    expect(metaB.windowSignals).toBeUndefined();
    expect(wm()._signalsBound).toBe(false);
  });

  it("a missing target with pending signal ids is a no-op, not a TypeError", () => {
    seedSignalState([]);
    // Simulate a torn-down global: ids recorded but the target is gone.
    wm()._windowManagerSignals = [201];
    const savedWindowManager = global.window_manager;
    global.window_manager = undefined;

    try {
      expect(() => wm()._removeSignals()).not.toThrow();
      expect(wm()._signalsBound).toBe(false);
    } finally {
      global.window_manager = savedWindowManager;
    }
  });
});
