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
 * Bug forge-obka.5: renderTree checked tiling-mode-enabled only at CALL time; its
 * idle callback re-checked just the freeze. A render queued while tiling was on
 * still ran processFloats + tree.render after the user turned tiling off,
 * re-laying out windows Forge had been told to leave alone.
 *
 * The default GLib mock runs idle_add synchronously, so we defer it and flush
 * manually to open the schedule-time-vs-fire-time gap (bug-forge-opsl harness).
 */
describe("Bug forge-obka.5: turning tiling off after scheduling suppresses the queued render", () => {
  it("does not render when tiling is turned off between schedule and fire", () => {
    const renderSpy = vi.spyOn(wm.tree, "render");
    const floatsSpy = vi.spyOn(wm, "processFloats");

    wm.renderTree("focus");
    expect(wm._renderTreeSrcId).not.toBe(0);

    wm.ext.settings.set_boolean("tiling-mode-enabled", false);
    flush();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(floatsSpy).not.toHaveBeenCalled();
    expect(wm._renderTreeSrcId).toBe(0);
  });

  it("still renders when tiling stays on (control)", () => {
    const renderSpy = vi.spyOn(wm.tree, "render");

    wm.renderTree("focus");
    flush();

    expect(renderSpy).toHaveBeenCalled();
  });
});
