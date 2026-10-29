import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MaximizeFlags, Window } from "../../mocks/gnome/Meta.js";

// Compat dispatches on IS_MUTTER_49_PLUS which is computed from
// PACKAGE_VERSION at module load. tests/setup.js mocks that resource
// globally to "47.0"; to exercise both branches we re-mock per-test and
// re-import the module fresh. Every test in this file MUST go through
// loadCompat() — a static `import` of compat.js here would resolve once
// against the global mock and freeze the version flag.
async function loadCompat(packageVersion) {
  vi.resetModules();
  vi.doMock("resource:///org/gnome/shell/misc/config.js", () => ({
    PACKAGE_VERSION: packageVersion,
  }));
  return await import("../../../lib/extension/compat.js");
}

afterEach(() => {
  vi.doUnmock("resource:///org/gnome/shell/misc/config.js");
});

describe("compat (Mutter 49+ branch)", () => {
  let Compat;
  beforeEach(async () => {
    Compat = await loadCompat("49.5");
  });

  it("exposes IS_MUTTER_49_PLUS = true", () => {
    expect(Compat.IS_MUTTER_49_PLUS).toBe(true);
  });

  describe("isMaximized", () => {
    it("calls is_maximized() and returns true when maximized", () => {
      const w = { is_maximized: vi.fn(() => true) };
      expect(Compat.isMaximized(w)).toBe(true);
      expect(w.is_maximized).toHaveBeenCalledOnce();
    });

    it("returns false when is_maximized() is false", () => {
      const w = { is_maximized: vi.fn(() => false) };
      expect(Compat.isMaximized(w)).toBe(false);
    });
  });

  describe("isNotMaximized", () => {
    it("returns true when is_maximized() is false", () => {
      const w = { is_maximized: vi.fn(() => false) };
      expect(Compat.isNotMaximized(w)).toBe(true);
    });

    it("returns false when is_maximized() is true", () => {
      const w = { is_maximized: vi.fn(() => true) };
      expect(Compat.isNotMaximized(w)).toBe(false);
    });
  });

  // Mutter 49+ (verified against window.c of 49.0, 50.5 and 51.0):
  // set_maximize_flags(flags) itself performs the maximize, and maximize() is
  // just set_maximize_flags(BOTH) plus an unmanaging guard. Calling both turns
  // a partial maximize into BOTH and maximizes twice.
  describe("maximize", () => {
    it("full maximize calls maximize() once (it carries the unmanaging guard)", () => {
      const w = { set_maximize_flags: vi.fn(), maximize: vi.fn() };
      Compat.maximize(w);
      expect(w.maximize).toHaveBeenCalledOnce();
      expect(w.maximize).toHaveBeenCalledWith();
      expect(w.set_maximize_flags).not.toHaveBeenCalled();
    });

    it("partial maximize calls only set_maximize_flags(flags)", () => {
      const w = { set_maximize_flags: vi.fn(), maximize: vi.fn() };
      Compat.maximize(w, MaximizeFlags.HORIZONTAL);
      expect(w.set_maximize_flags).toHaveBeenCalledOnce();
      expect(w.set_maximize_flags).toHaveBeenCalledWith(MaximizeFlags.HORIZONTAL);
      expect(w.maximize).not.toHaveBeenCalled();
    });
  });

  // On Mutter 51, set_unmaximize_flags()/unmaximize() on a window that is NOT
  // maximized is no longer a no-op: meta_window_process_config() falls through
  // to meta_window_move_resize(). Forge called this on every render, which is
  // the path that crashed gnome-shell 51 in meta_window_update_monitor(NULL).
  describe("unmaximize", () => {
    it("does nothing when the window is not maximized", () => {
      const w = {
        get_maximize_flags: vi.fn(() => 0),
        set_unmaximize_flags: vi.fn(),
        unmaximize: vi.fn(),
      };
      Compat.unmaximize(w);
      expect(w.unmaximize).not.toHaveBeenCalled();
      expect(w.set_unmaximize_flags).not.toHaveBeenCalled();
    });

    it.each([
      ["fully", MaximizeFlags.BOTH],
      ["vertically", MaximizeFlags.VERTICAL],
      ["horizontally", MaximizeFlags.HORIZONTAL],
    ])("calls unmaximize() exactly once when %s maximized", (_label, flags) => {
      const w = {
        get_maximize_flags: vi.fn(() => flags),
        set_unmaximize_flags: vi.fn(),
        unmaximize: vi.fn(),
      };
      Compat.unmaximize(w);
      expect(w.unmaximize).toHaveBeenCalledOnce();
      expect(w.unmaximize).toHaveBeenCalledWith();
      expect(w.set_unmaximize_flags).not.toHaveBeenCalled();
    });
  });

  describe("getMaximizeFlags", () => {
    it("returns get_maximize_flags() value", () => {
      const w = { get_maximize_flags: vi.fn(() => MaximizeFlags.BOTH) };
      expect(Compat.getMaximizeFlags(w)).toBe(MaximizeFlags.BOTH);
    });
  });

  // Drives a REAL Meta.Window mock (not inline vi.fn() stubs) end-to-end through
  // the 49+ shim path — proves the mock exposes is_maximized/set_maximize_flags/
  // get_maximize_flags and that they stay self-consistent. This is the coverage
  // forge-bc1 builds on.
  describe("with a real Meta.Window mock", () => {
    it("maximize(BOTH) then unmaximize round-trips through the shims", () => {
      const w = new Window();
      expect(Compat.isNotMaximized(w)).toBe(true);

      Compat.maximize(w);
      expect(Compat.isMaximized(w)).toBe(true);
      expect(Compat.getMaximizeFlags(w)).toBe(MaximizeFlags.BOTH);

      Compat.unmaximize(w);
      expect(Compat.isNotMaximized(w)).toBe(true);
      expect(Compat.getMaximizeFlags(w)).toBe(0);
    });

    it("partial maximize(HORIZONTAL) round-trips without being reported fully maximized", () => {
      const w = new Window();
      Compat.maximize(w, MaximizeFlags.HORIZONTAL);
      // set_maximize_flags(HORIZONTAL) then maximize() must NOT clobber to BOTH.
      expect(Compat.getMaximizeFlags(w)).toBe(MaximizeFlags.HORIZONTAL);
      // On 49+, is_maximized() is both-axes, so a partial maximize is "not maximized".
      expect(Compat.isMaximized(w)).toBe(false);
      expect(Compat.isNotMaximized(w)).toBe(true);
    });
  });
});

describe("compat (Mutter 48 branch)", () => {
  let Compat;
  beforeEach(async () => {
    Compat = await loadCompat("48.7");
  });

  it("exposes IS_MUTTER_49_PLUS = false", () => {
    expect(Compat.IS_MUTTER_49_PLUS).toBe(false);
  });

  describe("isMaximized", () => {
    it("returns true when get_maximized() === BOTH", () => {
      const w = { get_maximized: vi.fn(() => MaximizeFlags.BOTH) };
      expect(Compat.isMaximized(w)).toBe(true);
    });

    it("returns false for partial maximize (HORIZONTAL)", () => {
      const w = { get_maximized: vi.fn(() => MaximizeFlags.HORIZONTAL) };
      expect(Compat.isMaximized(w)).toBe(false);
    });

    it("returns false when not maximized", () => {
      const w = { get_maximized: vi.fn(() => 0) };
      expect(Compat.isMaximized(w)).toBe(false);
    });
  });

  describe("isNotMaximized", () => {
    it("returns true when get_maximized() === 0", () => {
      const w = { get_maximized: vi.fn(() => 0) };
      expect(Compat.isNotMaximized(w)).toBe(true);
    });

    it("returns false when partially maximized", () => {
      const w = { get_maximized: vi.fn(() => MaximizeFlags.VERTICAL) };
      expect(Compat.isNotMaximized(w)).toBe(false);
    });

    it("returns false when fully maximized", () => {
      const w = { get_maximized: vi.fn(() => MaximizeFlags.BOTH) };
      expect(Compat.isNotMaximized(w)).toBe(false);
    });
  });

  describe("maximize", () => {
    it("calls maximize(flags) directly with no set_maximize_flags", () => {
      const w = { maximize: vi.fn(), set_maximize_flags: vi.fn() };
      Compat.maximize(w);
      expect(w.maximize).toHaveBeenCalledWith(MaximizeFlags.BOTH);
      expect(w.set_maximize_flags).not.toHaveBeenCalled();
    });

    it("honors an explicit flags argument", () => {
      const w = { maximize: vi.fn() };
      Compat.maximize(w, MaximizeFlags.VERTICAL);
      expect(w.maximize).toHaveBeenCalledWith(MaximizeFlags.VERTICAL);
    });
  });

  describe("unmaximize", () => {
    it("does nothing when the window is not maximized", () => {
      const w = { get_maximized: vi.fn(() => 0), unmaximize: vi.fn() };
      Compat.unmaximize(w);
      expect(w.unmaximize).not.toHaveBeenCalled();
    });

    it("calls unmaximize(BOTH) once and does not touch set_unmaximize_flags", () => {
      const w = {
        get_maximized: vi.fn(() => MaximizeFlags.VERTICAL),
        unmaximize: vi.fn(),
        set_unmaximize_flags: vi.fn(),
      };
      Compat.unmaximize(w);
      expect(w.unmaximize).toHaveBeenCalledOnce();
      expect(w.unmaximize).toHaveBeenCalledWith(MaximizeFlags.BOTH);
      expect(w.set_unmaximize_flags).not.toHaveBeenCalled();
    });
  });

  describe("getMaximizeFlags", () => {
    it("returns get_maximized() value", () => {
      const w = { get_maximized: vi.fn(() => MaximizeFlags.HORIZONTAL) };
      expect(Compat.getMaximizeFlags(w)).toBe(MaximizeFlags.HORIZONTAL);
    });
  });
});

// GNOME 51 removed two APIs Forge used directly (gjs.guide "Port Extensions to
// GNOME Shell 51"): the St `vertical` property (deprecated at 48 in favor of
// `orientation`) and Clutter.get_default_backend() (replaced by
// global.stage.context.get_backend()). Each branch of both shims is covered here.
describe("stBoxOrientation", () => {
  it("uses the legacy `vertical` prop before GNOME 48 (no St orientation prop yet)", async () => {
    const Compat = await loadCompat("47.2");
    expect(Compat.stBoxOrientation(true)).toEqual({ vertical: true });
    expect(Compat.stBoxOrientation(false)).toEqual({ vertical: false });
  });

  it.each(["48.0", "50.4", "51.0"])("uses Clutter.Orientation on GNOME %s", async (v) => {
    const Compat = await loadCompat(v);
    const {
      default: { Orientation },
    } = await import("gi://Clutter");
    expect(Compat.stBoxOrientation(true)).toEqual({ orientation: Orientation.VERTICAL });
    expect(Compat.stBoxOrientation(false)).toEqual({ orientation: Orientation.HORIZONTAL });
  });
});

describe("getClutterBackend", () => {
  afterEach(() => {
    delete global.stage;
  });

  it("uses Clutter.get_default_backend() up to GNOME 50", async () => {
    const Compat = await loadCompat("50.4");
    const { default: Clutter } = await import("gi://Clutter");
    global.stage = { context: { get_backend: vi.fn() } };
    expect(Compat.getClutterBackend()).toBe(Clutter.get_default_backend());
    expect(global.stage.context.get_backend).not.toHaveBeenCalled();
  });

  it("uses global.stage.context.get_backend() on GNOME 51+", async () => {
    const Compat = await loadCompat("51.0");
    const backend = { get_default_seat: vi.fn() };
    global.stage = { context: { get_backend: vi.fn(() => backend) } };
    expect(Compat.getClutterBackend()).toBe(backend);
  });
});

describe("compat getMinFrameSize", () => {
  let Compat;
  beforeEach(async () => {
    Compat = await loadCompat("50.0");
  });

  it("is null when the window reports no minimum", () => {
    expect(Compat.getMinFrameSize(new Window({}))).toBe(null);
  });

  it("adds the frame extents to the client minimum", () => {
    const win = new Window({ size_hints: { min_width: 400, min_height: 300 } });
    // A server-side title bar: the client is 30 px shorter than the frame
    win.frame_rect_to_client_rect = (r) => ({ ...r, y: r.y + 30, height: r.height - 30 });
    expect(Compat.getMinFrameSize(win)).toEqual({ min_width: 400, min_height: 330 });
  });

  it.each(["45.0", "49.5"])("is null on GNOME %s, which has no get_min_size", async (v) => {
    const OldCompat = await loadCompat(v);
    const win = new Window({ size_hints: { min_width: 400, min_height: 300 } });
    win.get_min_size = vi.fn(() => {
      throw new Error("Meta.Window has no get_min_size before Mutter 50");
    });
    expect(OldCompat.getMinFrameSize(win)).toBe(null);
    expect(win.get_min_size).not.toHaveBeenCalled();
  });
});
