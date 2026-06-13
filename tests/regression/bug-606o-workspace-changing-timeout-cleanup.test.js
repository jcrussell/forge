import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-606o: the 300ms workspace-transition timer (_workspaceChangingTimeoutId,
 * armed in the active-workspace-changed handler) was never cleared in
 * _removeSignals, so it could outlive disable() and fire its callback into a
 * dead WindowManager. _removeSignals clears its seven sibling source ids via
 * _clearTimeoutId but skipped this one.
 */
describe("forge-606o: workspace-changing timeout cleanup", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("clears _workspaceChangingTimeoutId on _removeSignals", () => {
    const removeSpy = vi.spyOn(GLib.Source, "remove");
    const wm = ctx.windowManager;

    // Pretend the active-workspace-changed handler armed the transition timer.
    wm._workspaceChangingTimeoutId = 99;

    // _removeSignals only runs its cleanup block when signals are bound.
    wm._signalsBound = true;
    wm._removeSignals();

    expect(removeSpy).toHaveBeenCalledWith(99);
    expect(wm._workspaceChangingTimeoutId).toBe(0);
  });
});
