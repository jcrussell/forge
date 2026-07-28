import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWindowManagerFixture,
  createTiledWindow,
  finalizeWindow,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-z9ky (audit-rc-2026-07 / F4): handleUnmaximizeForTiling() guarded
 * only with `!metaWindow || metaWindow.minimized` — a finalized wrapper is
 * truthy so `.minimized` throws. It is reached synchronously from trackWindow
 * (window-created) before pruneDeadWindows, so the throw aborts trackWindow and
 * the new window fails to tile that cycle. Gated by auto-unmaximize-for-tiling.
 *
 * Fix: guard with Utils.isWindowAlive.
 */
describe("Bug forge-z9ky: handleUnmaximizeForTiling skips finalized siblings", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "auto-unmaximize-for-tiling": true },
    });
  });

  afterEach(() => ctx.cleanup());

  it("does not throw when a tiled sibling on the monitor is finalized", () => {
    // The dead sibling is set up first, then finalized.
    const { metaWindow: dead } = createTiledWindow(ctx, { id: 9401 });
    finalizeWindow(dead);

    // The newly-created window that triggers the unmaximize sweep.
    const { nodeWindow: newNode } = createTiledWindow(ctx, { id: 9402 });

    expect(() => ctx.windowManager.handleUnmaximizeForTiling(newNode)).not.toThrow();
  });
});
