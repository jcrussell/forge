import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug #472: windows wrongly float because isFloatingExempt matched WM classes with a
 * reversed substring test (override.wmClass.includes(windowClass)) instead of equality.
 * A window whose class is a substring of an override's class (e.g. "fire" vs a "firefox"
 * float rule) was incorrectly classified.
 */
describe("Bug #472: isFloatingExempt class matching is exact, not substring", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;
  const setOverrides = (overrides) => {
    wm().windowProps = { overrides };
  };

  it("does not float a window whose class is only a substring of a float override", () => {
    setOverrides([{ wmClass: "firefox", mode: "float" }]);
    const win = createMockWindow({ wm_class: "fire", title: "Editor" });
    expect(wm().isFloatingExempt(win)).toBe(false);
  });

  it("still floats a window whose class exactly matches a float override", () => {
    setOverrides([{ wmClass: "firefox", mode: "float" }]);
    const win = createMockWindow({ wm_class: "firefox", title: "Browser" });
    expect(wm().isFloatingExempt(win)).toBe(true);
  });

  it("supports comma-separated class lists in a float override", () => {
    setOverrides([{ wmClass: "firefox,thunderbird", mode: "float" }]);
    const win = createMockWindow({ wm_class: "thunderbird", title: "Mail" });
    expect(wm().isFloatingExempt(win)).toBe(true);
  });

  it("does not let a substring class match a tile override (which would suppress a needed float)", () => {
    // allows_resize:false makes the window float-by-type; a tile rule for "firefox"
    // must NOT match a "fire" window and cancel that float.
    setOverrides([{ wmClass: "firefox", mode: "tile" }]);
    const win = createMockWindow({ wm_class: "fire", title: "Editor", allows_resize: false });
    expect(wm().isFloatingExempt(win)).toBe(true);
  });
});
