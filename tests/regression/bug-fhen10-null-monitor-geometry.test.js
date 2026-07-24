import { describe, it, expect, afterEach } from "vitest";
import { LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug forge-fhen.10: global.display.get_monitor_geometry() returns null for an
 * invalid monitor index, and get_current_monitor() can transiently return -1
 * (monitors-changed / startup). determineSplitLayout() dereferenced the result's
 * .width/.height with no guard, crashing the split-container orientation path.
 * Utils.getMonitorGeometrySafe now coerces that to null; this pins the guard.
 * The lenient base mock never returns null unless a test asks for it — this one
 * asks (monitorGeometries: [null]).
 */
describe("Bug forge-fhen.10: null get_monitor_geometry() is guarded", () => {
  let ctx;

  afterEach(() => ctx?.cleanup());

  it("determineSplitLayout falls back to HSPLIT when geometry is unavailable", () => {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorGeometries: [null] } },
    });

    let result;
    expect(() => {
      result = ctx.windowManager.determineSplitLayout();
    }).not.toThrow();
    expect(result).toBe(LAYOUT_TYPES.HSPLIT);
  });
});
