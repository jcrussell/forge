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

  describe("maximize", () => {
    it("calls set_maximize_flags(BOTH) then maximize() with no args", () => {
      const w = { set_maximize_flags: vi.fn(), maximize: vi.fn() };
      Compat.maximize(w);
      expect(w.set_maximize_flags).toHaveBeenCalledWith(MaximizeFlags.BOTH);
      expect(w.maximize).toHaveBeenCalledOnce();
      expect(w.maximize).toHaveBeenCalledWith();
    });

    it("honors an explicit flags argument", () => {
      const w = { set_maximize_flags: vi.fn(), maximize: vi.fn() };
      Compat.maximize(w, MaximizeFlags.HORIZONTAL);
      expect(w.set_maximize_flags).toHaveBeenCalledWith(MaximizeFlags.HORIZONTAL);
    });
  });

  describe("unmaximize", () => {
    it("calls set_unmaximize_flags(BOTH) then unmaximize() with no args", () => {
      const w = { set_unmaximize_flags: vi.fn(), unmaximize: vi.fn() };
      Compat.unmaximize(w);
      expect(w.set_unmaximize_flags).toHaveBeenCalledWith(MaximizeFlags.BOTH);
      expect(w.unmaximize).toHaveBeenCalledOnce();
      expect(w.unmaximize).toHaveBeenCalledWith();
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
    it("calls unmaximize(BOTH) once and does not touch set_unmaximize_flags", () => {
      const w = { unmaximize: vi.fn(), set_unmaximize_flags: vi.fn() };
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
