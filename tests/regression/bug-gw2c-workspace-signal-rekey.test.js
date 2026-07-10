import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug forge-gw2c: _workspaceSignals is keyed by workspace INDEX but the signals
 * are connected on the workspace OBJECT. unbindWorkspaceSignals/destroy re-resolved
 * the object via get_workspace_by_index(index) — after a reorder the index→object
 * association is stale, so they disconnected the WRONG workspace (stranding a
 * survivor's handler) or missed the right one (leaking handlers past disable()).
 *
 * Fix: store the workspace object in the map value and disconnect from THAT object;
 * and on workspaces-reordered, destroy() (now object-anchored) before reloadTree so
 * the map is rebuilt against the current index→object association.
 */
describe("Bug forge-gw2c: workspace signal map is object-anchored", () => {
  let ctx, wsm, A, B, C;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 3, activeWorkspaceIndex: 0 } },
    });
    wsm = ctx.tree.workspaceManager;
    [A, B, C] = ctx.workspaces;
    // Deterministic clean state: rebind each workspace at its own index.
    wsm.destroy();
    ctx.workspaces.forEach((ws) => wsm.bindWorkspaceSignals(ws));
  });

  afterEach(() => ctx.cleanup());

  it("unbind disconnects the originally-bound workspace, not a reorder-resolved one", () => {
    expect(A.hasHandlers("window-added")).toBe(true);
    expect(B.hasHandlers("window-added")).toBe(true);

    // Simulate a reorder: index 0 now resolves to B (the stale-map hazard).
    ctx.workspaceManager.get_workspace_by_index.mockImplementation((i) =>
      i === 0 ? B : ctx.workspaces[i]
    );

    wsm.unbindWorkspaceSignals(0);

    // The handler that was bound AT index 0 (A) is gone; B is untouched.
    expect(A.hasHandlers("window-added")).toBe(false);
    expect(B.hasHandlers("window-added")).toBe(true);
  });

  it("destroy disconnects every bound workspace after a reorder (no leak)", () => {
    // Reorder: swap B/C so index 1->C, index 2->B.
    ctx.workspaceManager.get_workspace_by_index.mockImplementation((i) => {
      if (i === 1) return C;
      if (i === 2) return B;
      return ctx.workspaces[i];
    });

    wsm.destroy();

    // All three originally-bound handlers are disconnected — none leak past disable.
    expect(A.hasHandlers("window-added")).toBe(false);
    expect(B.hasHandlers("window-added")).toBe(false);
    expect(C.hasHandlers("window-added")).toBe(false);
  });

  it("the workspaces-reordered handler rebuilds the signal map (destroy + reload)", () => {
    ctx.settings.connect = vi.fn(() => 1);
    const destroySpy = vi.spyOn(wsm, "destroy");
    const reload = vi.spyOn(ctx.windowManager, "reloadTree").mockImplementation(() => {});

    ctx.windowManager._bindSignals();
    ctx.workspaceManager.emit("workspaces-reordered");

    expect(destroySpy).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledWith("workspaces-reordered");
  });
});
