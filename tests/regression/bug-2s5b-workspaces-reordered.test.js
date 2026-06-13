import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-2s5b: nothing connected the workspace_manager "workspaces-reordered"
 * signal. Meta.WorkspaceManager.reorder_workspace() changes workspace indices
 * WITHOUT emitting workspace-added/removed and WITHOUT per-window
 * workspace-changed, so the tree's index-keyed nodes (ws{n}, mo{m}ws{n}) keep
 * pointing at the workspace that PREVIOUSLY held that index. A new window then
 * tiles into the wrong workspace's subtree, and focus/decorations operate on the
 * wrong set, until an unrelated tree reload.
 *
 * The reorder signal carries no permutation args and WORKSPACE nodes store no
 * Meta.Workspace reference, so a targeted single-pass rekey is impossible/unsafe.
 * Fix: connect "workspaces-reordered" and call reloadTree, which rebuilds the
 * index-keyed workspace/monitor scaffold from LIVE workspace indices and re-homes
 * every window by its current workspace — correcting the stale keys.
 */
describe("forge-2s5b: workspaces-reordered triggers a tree reload to fix stale keys", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 3, activeWorkspaceIndex: 0 } },
    });
    // Give the mock settings a connect() so the rest of _bindSignals runs (same
    // idiom as bug-85ex-monitors-changed).
    ctx.settings.connect = vi.fn(() => 1);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("connects the workspace_manager workspaces-reordered signal in _bindSignals", () => {
    vi.spyOn(ctx.windowManager, "reloadTree").mockImplementation(() => {});

    ctx.windowManager._bindSignals();

    expect(ctx.workspaceManager.hasHandlers("workspaces-reordered")).toBe(true);
  });

  it("reloads the tree when workspaces-reordered fires", () => {
    const reload = vi.spyOn(ctx.windowManager, "reloadTree").mockImplementation(() => {});

    ctx.windowManager._bindSignals();
    // Reorder happened (no useful args on the signal); emit it.
    ctx.workspaceManager.emit("workspaces-reordered");

    expect(reload).toHaveBeenCalledWith("workspaces-reordered");
  });
});
