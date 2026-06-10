import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { createWindowManagerFixture } from "../mocks/helpers/testFixtures.js";

/**
 * Bug #531 hardening: a JS throw inside renderTree's idle callback (or a
 * queued event's callback in queueEvent's drain loop) left the source id
 * (_renderTreeSrcId / _queueSourceId) stuck non-zero after GJS removed the
 * throwing source. Every later renderTree()/queueEvent() then no-oped
 * forever, so newly created windows stayed in their initial FLOAT mode —
 * "Forge can't tile".
 *
 * The default GLib mock runs idle_add synchronously (the throw would escape
 * before the source id is even assigned), so these tests swap in deferred
 * implementations and flush manually — mirroring real GJS, where the
 * callback runs after idle_add has returned.
 */
describe("Bug #531: render/queue wedge after a throwing callback", () => {
  let ctx;
  let wm;
  const realIdleAdd = GLib.idle_add;
  const realTimeoutAdd = GLib.timeout_add;
  let pending;

  beforeEach(() => {
    pending = [];
    GLib.idle_add = (priority, cb) => {
      pending.push(cb);
      return pending.length; // non-zero source id
    };
    GLib.timeout_add = (priority, interval, cb) => {
      pending.push(cb);
      return pending.length;
    };

    ctx = createWindowManagerFixture();
    wm = ctx.windowManager;
  });

  afterEach(() => {
    GLib.idle_add = realIdleAdd;
    GLib.timeout_add = realTimeoutAdd;
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  // Run all captured source callbacks like the GLib main loop would: a throw
  // removes the source (swallowed here, logged in GJS), repeat-requests requeue.
  function flush() {
    while (pending.length) {
      const cb = pending.shift();
      try {
        if (cb() === true) pending.push(cb);
      } catch (e) {
        // GJS logs and removes the source; the id is NOT reset by GLib.
      }
    }
  }

  it("a throwing render pass must not permanently disable renderTree", () => {
    vi.spyOn(wm, "processFloats").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const renderSpy = vi.spyOn(wm.tree, "render");

    wm.renderTree("t1");
    expect(wm._renderTreeSrcId).not.toBe(0);
    flush();

    // The throwing pass must reset the id so the next render can schedule.
    expect(wm._renderTreeSrcId).toBe(0);

    wm.renderTree("t2");
    flush();
    expect(renderSpy).toHaveBeenCalled();
  });

  it("a throwing queued event must not kill the event queue", () => {
    wm.queueEvent({
      name: "bad",
      callback: () => {
        throw new Error("boom");
      },
    });
    flush();

    expect(wm._queueSourceId).toBe(0);

    const good = vi.fn();
    wm.queueEvent({ name: "good", callback: good });
    flush();
    expect(good).toHaveBeenCalled();
  });

  it("a throwing event mid-queue still drains the rest of the queue", () => {
    const after = vi.fn();
    wm.queueEvent({
      name: "bad",
      callback: () => {
        throw new Error("boom");
      },
    });
    wm.queueEvent({ name: "after", callback: after });
    flush();

    expect(after).toHaveBeenCalled();
    expect(wm._queueSourceId).toBe(0);
  });
});
