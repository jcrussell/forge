import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { createWindowManagerFixture } from "../mocks/helpers/testFixtures.js";

/**
 * Bug forge-opsl: renderTree's idle callback evaluated the freeze guard only at
 * CALL time. A force render scheduled while UNfrozen (e.g. focus on an unfocused
 * tiled window) then fired even after a LATER freezeRender() (grab-op-begin), and
 * tree.render() reflowed the sibling tiled windows into the vacated slot mid-drag
 * — exactly the reflow the freeze exists to prevent.
 *
 * Fix: re-check _freezeRender at the top of the idle body. The default GLib mock
 * runs idle_add synchronously, so we defer it and flush manually to reproduce the
 * schedule-time-vs-fire-time gap (mirrors bug-531's harness).
 */
describe("Bug forge-opsl: a freeze applied after scheduling suppresses the queued render", () => {
  let ctx, wm;
  const realIdleAdd = GLib.idle_add;
  let pending;

  beforeEach(() => {
    pending = [];
    GLib.idle_add = (priority, cb) => {
      pending.push(cb);
      return pending.length; // non-zero source id
    };
    ctx = createWindowManagerFixture();
    wm = ctx.windowManager;
  });

  afterEach(() => {
    GLib.idle_add = realIdleAdd;
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  function flush() {
    while (pending.length) {
      const cb = pending.shift();
      if (cb() === true) pending.push(cb);
    }
  }

  it("does not render when a freeze lands between schedule and fire", () => {
    const renderSpy = vi.spyOn(wm.tree, "render");

    // Unfrozen force render schedules the idle (wasFrozen = false).
    wm.renderTree("focus", true);
    expect(wm._renderTreeSrcId).not.toBe(0);

    // A different path freezes AFTER scheduling (grab-op-begin) — it does not
    // cancel the queued idle.
    wm.freezeRender();

    flush();

    // Pre-fix the idle ignored the freeze and reflowed the siblings; post-fix it
    // re-checks _freezeRender and bails before tree.render().
    expect(renderSpy).not.toHaveBeenCalled();
    expect(wm._renderTreeSrcId).toBe(0);
  });

  it("still renders normally when no freeze intervenes", () => {
    const renderSpy = vi.spyOn(wm.tree, "render");

    wm.renderTree("focus", true);
    flush();

    expect(renderSpy).toHaveBeenCalled();
  });
});
