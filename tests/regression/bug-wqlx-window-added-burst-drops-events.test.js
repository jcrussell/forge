import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { WorkspaceManager } from "../../lib/extension/workspace.js";
import { createMockWindow, installGnomeGlobals } from "../mocks/helpers/index.js";

/**
 * forge-wqlx: the window-added handler scheduled its 200ms re-home timeout only
 * when the single shared `_wsWindowAddSrcId` was falsy, and the timeout closure
 * captured just the FIRST event's metaWindow. So within any 200ms burst (session
 * restore, multi-window apps) only the first window's monitor re-home ran; every
 * other window was silently dropped until a later unrelated event.
 *
 * Fix: queue every window added during the debounce and flush them all in one
 * timeout, isolating each so a finalized window cannot strand its siblings.
 */
describe("forge-wqlx: window-added debounce re-homes every window in a burst", () => {
  let ctx;
  let workspaceManager;
  let extWm;
  let workspace;
  let timeouts;

  beforeEach(() => {
    ctx = installGnomeGlobals();
    workspace = ctx.workspaces[0];
    extWm = {
      updateMetaWorkspaceMonitor: vi.fn(),
      _wsWindowAddSrcId: 0,
      _wsWindowAddQueue: null,
    };
    workspaceManager = new WorkspaceManager({}, extWm);

    timeouts = [];
    vi.spyOn(GLib, "timeout_add").mockImplementation((priority, interval, callback) => {
      timeouts.push(callback);
      return timeouts.length; // distinct non-zero IDs
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("flushes all windows added within a single 200ms debounce", () => {
    workspaceManager.bindWorkspaceSignals(workspace);

    const winA = createMockWindow({ wm_class: "AppA" });
    const winB = createMockWindow({ wm_class: "AppB" });

    workspace.emit("window-added", workspace, winA);
    workspace.emit("window-added", workspace, winB);

    // A single shared debounce timer coalesces the burst.
    expect(timeouts.length).toBe(1);

    timeouts[0]();

    // BOTH windows must be re-homed, not just the first.
    expect(extWm.updateMetaWorkspaceMonitor).toHaveBeenCalledWith(
      "window-added",
      winA.get_monitor(),
      winA
    );
    expect(extWm.updateMetaWorkspaceMonitor).toHaveBeenCalledWith(
      "window-added",
      winB.get_monitor(),
      winB
    );
    expect(extWm._wsWindowAddSrcId).toBe(0);
  });

  it("still flushes live windows when one queued window was finalized", () => {
    workspaceManager.bindWorkspaceSignals(workspace);

    const dead = createMockWindow({ wm_class: "Dead" });
    dead.get_monitor = vi.fn(() => {
      throw new Error("Object 0xdead has been already deallocated");
    });
    const live = createMockWindow({ wm_class: "Live" });

    workspace.emit("window-added", workspace, dead);
    workspace.emit("window-added", workspace, live);
    expect(timeouts.length).toBe(1);

    // The finalized window must neither throw out of the callback nor strand
    // the live one, and the guard must still reset.
    expect(() => timeouts[0]()).not.toThrow();
    expect(extWm.updateMetaWorkspaceMonitor).toHaveBeenCalledWith(
      "window-added",
      live.get_monitor(),
      live
    );
    expect(extWm._wsWindowAddSrcId).toBe(0);
  });
});
