import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { WorkspaceManager } from "../../lib/extension/workspace.js";
import { createMockWindow, installGnomeGlobals } from "../mocks/helpers/index.js";

/**
 * forge-7c7o: the window-added 200ms debounce reset `_wsWindowAddSrcId = 0`
 * only AFTER calling `metaWindow.get_monitor()`. A window destroyed (and its
 * GObject wrapper finalized) within the debounce throws there, the reset is
 * skipped, and the `if (!_wsWindowAddSrcId)` guard then suppresses every
 * future window-added reconcile for the session — the same wedge class the
 * forge-cuv renderTree fix (dd77050) addressed with reset-in-finally.
 */
describe("forge-7c7o: window-added debounce survives a finalized window", () => {
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

  it("resets the debounce ID even when the captured window throws", () => {
    workspaceManager.bindWorkspaceSignals(workspace);

    const deadWindow = createMockWindow({ wm_class: "ShortLived" });
    deadWindow.get_monitor = vi.fn(() => {
      throw new Error("Object 0xdead has been already deallocated");
    });

    workspace.emit("window-added", workspace, deadWindow);
    expect(extWm._wsWindowAddSrcId).toBe(1);

    // The debounce fires after the window was finalized: the callback throws,
    // but the guard ID must still be reset or the path wedges forever.
    expect(() => timeouts[0]()).toThrow(/deallocated/);
    expect(extWm._wsWindowAddSrcId).toBe(0);

    // A later window-added must schedule a fresh debounce and reach the
    // reconcile — this is what the wedge silently suppressed.
    const liveWindow = createMockWindow({ wm_class: "App" });
    workspace.emit("window-added", workspace, liveWindow);
    expect(extWm._wsWindowAddSrcId).toBe(2);

    timeouts[1]();
    expect(extWm.updateMetaWorkspaceMonitor).toHaveBeenCalledWith(
      "window-added",
      liveWindow.get_monitor(),
      liveWindow
    );
    expect(extWm._wsWindowAddSrcId).toBe(0);
  });
});
