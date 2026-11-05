import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { createWindowManagerFixture } from "../mocks/helpers/testFixtures.js";

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
  it("does not render when a freeze lands between schedule and fire", () => {
    const renderSpy = vi.spyOn(wm.tree, "render");

    // Unfrozen force render schedules the idle (no re-freeze owed).
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

/**
 * Bug forge-ds8f: the re-freeze a force render owes was held in renderTree's
 * per-call closure. (a) A force render mid-drag while an earlier render was still
 * pending unfroze and scheduled nothing; the pending idle owed nothing, so the
 * drag lost its freeze. (b) A force render mid-drag followed by grab-op-end before
 * the idle fired re-froze after the grab had ended, stranding the freeze.
 */
describe("Bug forge-ds8f: a force render's re-freeze survives a pending idle", () => {
  it("(a) re-freezes after a force render joins an idle scheduled before the freeze", () => {
    const renderSpy = vi.spyOn(wm.tree, "render");
    wm.renderTree("focus", true); // scheduled unfrozen, before grab-op-begin
    wm.freezeRender(); // grab-op-begin

    wm.renderTree("window-create", true); // joins the pending idle
    flush();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(wm._freezeRender).toBe(true);
  });

  it("(b) does not re-freeze when the freeze ends before the idle fires", () => {
    wm.freezeRender(); // grab-op-begin
    wm.renderTree("window-create", true);
    wm.unfreezeRender(); // grab-op-end

    flush();

    expect(wm._freezeRender).toBe(false);
  });

  it("re-freezes after a force render through a freeze (control)", () => {
    const renderSpy = vi.spyOn(wm.tree, "render");
    wm.freezeRender();
    wm.renderTree("window-create", true);
    flush();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(wm._freezeRender).toBe(true);
  });
});
