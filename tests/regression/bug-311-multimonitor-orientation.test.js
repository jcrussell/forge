import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug #311 (forge-5ng): Tall monitor tiling — wrong default orientation per monitor.
 *
 * Problem: With a mixed setup (e.g. a landscape primary + a rotated/portrait
 * secondary), every monitor's tree node received the SAME default split layout —
 * the orientation of whichever monitor happened to be focused — so a portrait
 * monitor tiled horizontally instead of vertically.
 *
 * Root Cause: MonitorManager.addMonitor() loops over each monitor index `mi` but
 * called WindowManager.determineSplitLayout(), which reads
 * global.display.get_current_monitor() rather than the geometry of monitor `mi`.
 *
 * These tests drive the REAL addMonitor() path (via Tree construction) so the
 * orientation comes from the actual per-monitor geometry, not a hand-set value.
 */
describe("Bug #311: Per-monitor default split orientation (multi-monitor)", () => {
  let ctx;

  // Landscape monitor 0 is "current"; monitor 1 is rotated/portrait.
  const setup = () =>
    createWindowManagerFixture({
      globals: {
        display: {
          monitorCount: 2,
          monitorGeometries: [
            { x: 0, y: 0, width: 1920, height: 1080 }, // landscape (current)
            { x: 1920, y: 0, width: 1080, height: 1920 }, // portrait
          ],
        },
      },
    });

  afterEach(() => {
    ctx?.cleanup();
  });

  it("gives a portrait monitor VSPLIT even when a landscape monitor is focused", () => {
    ctx = setup();
    ctx.display.get_current_monitor.mockReturnValue(0); // landscape focused

    const landscapeNode = ctx.tree.findNode("mo0ws0");
    const portraitNode = ctx.tree.findNode("mo1ws0");

    expect(landscapeNode).toBeTruthy();
    expect(portraitNode).toBeTruthy();

    // Landscape monitor tiles horizontally...
    expect(landscapeNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    // ...and the portrait monitor tiles vertically, independent of the focused one.
    expect(portraitNode.layout).toBe(LAYOUT_TYPES.VSPLIT);
  });

  it("assigns each monitor its own orientation when adding a fresh workspace", () => {
    ctx = setup();
    ctx.display.get_current_monitor.mockReturnValue(0);

    // Drive the real path for a new workspace index.
    ctx.tree.addWorkspace(1);
    ctx.tree.addMonitor(1);

    expect(ctx.tree.findNode("mo0ws1").layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(ctx.tree.findNode("mo1ws1").layout).toBe(LAYOUT_TYPES.VSPLIT);
  });
});
