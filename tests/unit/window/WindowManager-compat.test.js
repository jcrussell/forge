import { describe, it, expect, vi } from "vitest";
import { WindowManager } from "../../../lib/extension/window.js";
import { MaximizeFlags } from "../../mocks/gnome/Meta.js";

describe("WindowManager GNOME 49 compat helpers", () => {
  describe("_safeUnmaximize()", () => {
    it("should use GNOME 49+ API when available", () => {
      const metaWindow = {
        set_unmaximize_flags: vi.fn(),
        unmaximize: vi.fn(),
      };
      WindowManager._safeUnmaximize(metaWindow);
      expect(metaWindow.set_unmaximize_flags).toHaveBeenCalledWith(MaximizeFlags.BOTH);
      expect(metaWindow.unmaximize).toHaveBeenCalledOnce();
      expect(metaWindow.unmaximize).toHaveBeenCalledWith();
    });

    it("should fall back to triple unmaximize when set_unmaximize_flags throws", () => {
      const metaWindow = {
        set_unmaximize_flags: vi.fn(() => {
          throw new Error("not a function");
        }),
        unmaximize: vi.fn(),
      };
      WindowManager._safeUnmaximize(metaWindow);
      expect(metaWindow.unmaximize).toHaveBeenCalledTimes(3);
      expect(metaWindow.unmaximize).toHaveBeenNthCalledWith(1, MaximizeFlags.HORIZONTAL);
      expect(metaWindow.unmaximize).toHaveBeenNthCalledWith(2, MaximizeFlags.VERTICAL);
      expect(metaWindow.unmaximize).toHaveBeenNthCalledWith(3, MaximizeFlags.BOTH);
    });

    it("should fall back when unmaximize() with no args throws (pre-49)", () => {
      let callCount = 0;
      const metaWindow = {
        set_unmaximize_flags: vi.fn(),
        unmaximize: vi.fn((...args) => {
          callCount++;
          if (callCount === 1 && args.length === 0) {
            throw new Error("requires argument");
          }
        }),
      };
      WindowManager._safeUnmaximize(metaWindow);
      expect(metaWindow.unmaximize).toHaveBeenCalledTimes(4);
    });
  });

  describe("_isMaximized()", () => {
    it("should use is_maximized() when available (GNOME 49+)", () => {
      const metaWindow = { is_maximized: () => true };
      expect(WindowManager._isMaximized(metaWindow)).toBe(true);
    });

    it("should return false via is_maximized() when not maximized", () => {
      const metaWindow = { is_maximized: () => false };
      expect(WindowManager._isMaximized(metaWindow)).toBe(false);
    });

    it("should fall back to get_maximized() when is_maximized() throws (pre-49)", () => {
      const metaWindow = {
        is_maximized: () => {
          throw new Error("not a function");
        },
        get_maximized: () => MaximizeFlags.BOTH,
      };
      expect(WindowManager._isMaximized(metaWindow)).toBe(true);
    });

    it("should return false via get_maximized() fallback when not maximized", () => {
      const metaWindow = {
        is_maximized: () => {
          throw new Error("not a function");
        },
        get_maximized: () => 0,
      };
      expect(WindowManager._isMaximized(metaWindow)).toBe(false);
    });

    it("should return false via get_maximized() fallback for partial maximize", () => {
      const metaWindow = {
        is_maximized: () => {
          throw new Error("not a function");
        },
        get_maximized: () => MaximizeFlags.HORIZONTAL,
      };
      expect(WindowManager._isMaximized(metaWindow)).toBe(false);
    });
  });

  describe("_isNotMaximized()", () => {
    it("should return true via is_maximized() when not maximized (GNOME 49+)", () => {
      const metaWindow = { is_maximized: () => false };
      expect(WindowManager._isNotMaximized(metaWindow)).toBe(true);
    });

    it("should return false via is_maximized() when maximized", () => {
      const metaWindow = { is_maximized: () => true };
      expect(WindowManager._isNotMaximized(metaWindow)).toBe(false);
    });

    it("should fall back to get_maximized() when is_maximized() throws (pre-49)", () => {
      const metaWindow = {
        is_maximized: () => {
          throw new Error("not a function");
        },
        get_maximized: () => 0,
      };
      expect(WindowManager._isNotMaximized(metaWindow)).toBe(true);
    });

    it("should return false via get_maximized() fallback when maximized", () => {
      const metaWindow = {
        is_maximized: () => {
          throw new Error("not a function");
        },
        get_maximized: () => MaximizeFlags.BOTH,
      };
      expect(WindowManager._isNotMaximized(metaWindow)).toBe(false);
    });

    it("should return false via get_maximized() fallback for partial maximize", () => {
      const metaWindow = {
        is_maximized: () => {
          throw new Error("not a function");
        },
        get_maximized: () => MaximizeFlags.VERTICAL,
      };
      expect(WindowManager._isNotMaximized(metaWindow)).toBe(false);
    });
  });
});
