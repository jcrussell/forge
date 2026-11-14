import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { createWindowManagerFixture } from "../mocks/helpers/testFixtures.js";
import { createMockWindow } from "../mocks/helpers/index.js";

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
 * Bug forge-8g78: minimize/unminimize unfroze rendering, queued renderTree and
 * re-froze straight away. The idle fired after the re-freeze and skipped, so a
 * window (un)minimized mid-grab never re-rendered.
 *
 * The default GLib mock runs idle_add synchronously, so we defer it and flush
 * manually to open the schedule-time-vs-fire-time gap (bug-forge-opsl harness).
 */
describe("Bug forge-8g78: minimize renders while rendering is frozen", () => {
  it("renders once and stays frozen", () => {
    const renderSpy = vi.spyOn(wm.tree, "render");
    wm.freezeRender(); // grab-op-begin

    wm._onMinimizeChange("minimize", { metaWindow: createMockWindow() });
    flush();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(wm._freezeRender).toBe(true);
  });

  it("keeps the freeze when tiling is off, since no render is queued to restore it", () => {
    const renderSpy = vi.spyOn(wm.tree, "render");
    wm.ext.settings.set_boolean("tiling-mode-enabled", false);
    wm.freezeRender(); // grab-op-begin

    wm.renderTree("minimize", true);
    flush();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(wm._freezeRender).toBe(true);
  });
});
