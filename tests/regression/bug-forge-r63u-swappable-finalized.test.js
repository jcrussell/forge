import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWindowManagerFixture,
  createTiledWindow,
  finalizeWindow,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-r63u (audit-rc-2026-07 follow-up, forge-icm0 family): _swappable()
 * reads `node.nodeValue.minimized` with no aliveness guard, and swapPairs (its
 * sole caller) reaches it via a raw this.next() sibling on the directional
 * move/swap keybinding paths — synchronous, pre-prune — before swapPairs's own
 * isWindowAlive guards run. A finalized-but-unpruned tiled sibling therefore
 * throws "already deallocated" and aborts the keybinding.
 *
 * Fix: add Utils.isWindowAlive to the _swappable condition — a dead window is
 * not swappable.
 */
describe("Bug forge-r63u: _swappable tolerates a finalized sibling", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("returns false (not a throw) for a finalized window node", () => {
    const { nodeWindow, metaWindow } = createTiledWindow(ctx, { id: 6301 });
    finalizeWindow(metaWindow);

    let result;
    expect(() => {
      result = ctx.tree._swappable(nodeWindow);
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("still returns true for a live, non-minimized tiled window", () => {
    const { nodeWindow } = createTiledWindow(ctx, { id: 6302 });
    expect(ctx.tree._swappable(nodeWindow)).toBe(true);
  });
});
