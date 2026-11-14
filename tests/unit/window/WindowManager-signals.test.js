import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../../mocks/helpers/index.js";

/**
 * The display, window manager, workspace manager, settings and overview live as
 * long as the shell, so a handler left on one pins the WindowManager and keeps
 * running after disable. _removeSignals must release all five even when
 * _bindSignals stopped partway or a later teardown step throws.
 */
describe("WindowManager - singleton signal teardown", () => {
  let ctx;
  let sources;

  const handlerCount = (source) =>
    Object.values(source._signals).reduce((n, handlers) => n + handlers.length, 0);
  const counts = () => sources.map(handlerCount);

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    ctx.display.get_tab_list = vi.fn(() => []);
    sources = [
      ctx.display,
      global.window_manager,
      ctx.workspaceManager,
      ctx.settings,
      ctx.overview,
    ];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("disable releases the sources bound before _bindSignals threw", () => {
    const before = counts();
    vi.spyOn(ctx.overview, "connectObject").mockImplementation(() => {
      throw new Error("bind failed");
    });

    expect(() => ctx.windowManager._bindSignals()).toThrow("bind failed");
    expect(handlerCount(ctx.display)).toBeGreaterThan(before[0]);

    ctx.windowManager.disable();

    expect(counts()).toEqual(before);
  });

  it("_removeSignals releases every source when a later step throws", () => {
    const before = counts();
    ctx.windowManager._bindSignals();
    vi.spyOn(ctx.windowManager, "_clearTimeoutId").mockImplementation(() => {
      throw new Error("teardown failed");
    });

    expect(() => ctx.windowManager._removeSignals()).toThrow("teardown failed");

    expect(counts()).toEqual(before);
  });
});
