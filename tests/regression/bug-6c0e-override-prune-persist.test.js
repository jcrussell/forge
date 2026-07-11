import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createWindowManagerFixture, createMockWindow } from "../mocks/helpers/index.js";

/**
 * forge-6c0e: the startup stale-wmId prune was cache-only and never persisted.
 *
 * reloadWindowOverrides(true) filtered wmId rows out of the in-memory cache but
 * never wrote the pruned set back to disk. Because configMgr.windowProps re-reads
 * (and re-parses) the file on every access, the very first _updateWindowOverrides
 * — which runs on every window close and every float toggle — read the still
 * unpruned file back into the cache (window.js:165, before the no-change return),
 * resurrecting every stale wmId override and defeating the prune entirely.
 *
 * The stock shared-object configMgr mock hides this (one object, so a cache-only
 * filter mutates "disk" too), so these tests install a fresh-copy-per-read
 * configMgr that matches the real ConfigManager getter/setter semantics.
 */
describe("forge-6c0e: startup wmId prune is persisted, not cache-only", () => {
  let ctx;

  // A configMgr whose getter returns a fresh deep copy each read and whose setter
  // replaces the backing store — i.e. real disk-round-trip semantics.
  function installDiskConfigMgr(initialOverrides) {
    let disk = initialOverrides.map((o) => ({ ...o }));
    ctx.windowManager.ext.configMgr = {
      get windowProps() {
        return { overrides: disk.map((o) => ({ ...o })) };
      },
      set windowProps(props) {
        disk = props.overrides.map((o) => ({ ...o }));
      },
    };
    return () => disk;
  }

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("writes the pruned override set back to disk", () => {
    const readDisk = installDiskConfigMgr([
      { wmClass: "Stale", wmId: 99, mode: "tile" },
      { wmClass: "Keep", mode: "float" },
    ]);

    ctx.windowManager.reloadWindowOverrides(true);

    // The stale per-window row must be gone from DISK, not just the cache.
    expect(readDisk().some((o) => o.wmId === 99)).toBe(false);
    expect(readDisk().some((o) => o.wmClass === "Keep")).toBe(true);
  });

  it("does not resurrect a pruned stale row on the first window close", () => {
    installDiskConfigMgr([
      { wmClass: "Stale", wmId: 99, mode: "tile" },
      { wmClass: "Keep", mode: "float" },
    ]);

    ctx.windowManager.reloadWindowOverrides(true);

    // windowDestroy runs the remove path on every close; here it changes nothing,
    // but _updateWindowOverrides still re-reads disk into the live cache first.
    const otherWindow = createMockWindow({ id: 5, wm_class: "Other" });
    ctx.windowManager.removeFloatOverride(otherWindow, true);

    expect(ctx.windowManager.windowProps.overrides.some((o) => o.wmId === 99)).toBe(false);
  });
});
