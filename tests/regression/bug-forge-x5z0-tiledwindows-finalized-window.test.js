import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createTiledWindow,
  finalizeWindow,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-x5z0 (audit-rc-2026-07 / F3): _tiledWindowsOnMonitor() filters
 * `t.isWindow() && !t.nodeValue.minimized` with no Utils.isWindowAlive probe,
 * unlike its guarded siblings. It runs synchronously pre-prune via
 * size-changed -> _shouldRejectExternalMaximize, so a finalized-but-unpruned
 * tiled sibling's `.minimized` throws "already deallocated" and aborts the
 * handler frame (border/decoration desync until the next render prune).
 *
 * Fix: skip dead windows via Utils.isWindowAlive in the filter.
 */
describe("Bug forge-x5z0: _tiledWindowsOnMonitor skips finalized windows", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("does not throw and excludes a finalized tiled sibling", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    const { nodeWindow: liveNode } = createTiledWindow(ctx, { id: 5301 });
    const { metaWindow: dead } = createTiledWindow(ctx, { id: 5302 });
    finalizeWindow(dead);

    let result;
    expect(() => {
      result = ctx.windowManager._tiledWindowsOnMonitor(monitor);
    }).not.toThrow();

    // Only the live window survives the filter; the dead one is dropped.
    expect(result).toContain(liveNode);
    expect(result.every((n) => n !== null)).toBe(true);
    expect(result).toHaveLength(1);
  });
});
