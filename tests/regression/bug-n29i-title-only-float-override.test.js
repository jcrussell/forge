import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug forge-n29i (extension matching side): a title-only float override (no
 * wmClass) could NEVER match — matchClass was initialized false and only set
 * when kf.wmClass existed, so the return `(!kf.wmTitle || matchTitle) && matchClass`
 * was always false. The fix lets a class-less float rule match on title alone,
 * while a degenerate rule with no criteria must still match nothing.
 *
 * NOTE: the prefs-side localeCompare crash in lib/prefs/floating.js remains open
 * and is tracked separately under forge-n29i.
 */
describe("Bug forge-n29i: title-only float override matches on title alone", () => {
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

  it("floats a window matching a class-less float rule by title (any wm_class)", () => {
    setOverrides([{ wmTitle: "Picture-in-Picture", mode: "float" }]);
    const pip = createMockWindow({ wm_class: "firefox", title: "Picture-in-Picture" });
    expect(wm().isFloatingExempt(pip)).toBe(true);

    const pipChrome = createMockWindow({ wm_class: "Google-chrome", title: "Picture-in-Picture" });
    expect(wm().isFloatingExempt(pipChrome)).toBe(true);
  });

  it("does not float a window with a different title via that rule", () => {
    setOverrides([{ wmTitle: "Picture-in-Picture", mode: "float" }]);
    const normal = createMockWindow({ wm_class: "firefox", title: "Mozilla Firefox" });
    expect(wm().isFloatingExempt(normal)).toBe(false);
  });

  it("does not float everything for a degenerate rule with no criteria", () => {
    setOverrides([{ mode: "float" }]);
    const normal = createMockWindow({ wm_class: "firefox", title: "Mozilla Firefox" });
    expect(wm().isFloatingExempt(normal)).toBe(false);
  });
});
