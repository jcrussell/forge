import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";
import { WindowType } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-11k: a title-specific FLOAT override must beat a class-only TILE rule.
 *
 * Chrome/Brave/Chromium ship CLASS-ONLY `mode:"tile"` rules in config/windows.json.
 * A Picture-in-Picture window is a resizable NORMAL window (floatByRole=false), so
 * the class-only tile rule force-tiled it BEFORE any float override was consulted,
 * silently ignoring a `{wmTitle:"Picture-in-Picture", mode:"float"}` rule for those
 * browsers. The fix lets a per-title/per-id float override beat a BARE class-only
 * tile rule, while an explicit per-title/per-id TILE override still force-tiles.
 */
describe("Bug forge-11k: title-specific float override beats class-only tile rule", () => {
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

  it("floats Chrome PIP despite a class-only tile rule for Google-chrome", () => {
    setOverrides([
      { wmClass: "Google-chrome", mode: "tile" },
      { wmTitle: "Picture-in-Picture", mode: "float" },
    ]);
    const pip = createMockWindow({
      wm_class: "Google-chrome",
      title: "Picture-in-Picture",
      window_type: WindowType.NORMAL,
      allows_resize: true,
    });
    expect(wm().isFloatingExempt(pip)).toBe(true);
  });

  it("matches the float title case-insensitively", () => {
    setOverrides([
      { wmClass: "Google-chrome", mode: "tile" },
      { wmTitle: "Picture-in-Picture", mode: "float" },
    ]);
    const pip = createMockWindow({
      wm_class: "Google-chrome",
      title: "picture-in-picture",
      window_type: WindowType.NORMAL,
      allows_resize: true,
    });
    expect(wm().isFloatingExempt(pip)).toBe(true);
  });

  it("force-tiles when an explicit per-title TILE override targets the PIP window", () => {
    setOverrides([
      { wmClass: "Google-chrome", mode: "tile" },
      { wmTitle: "Picture-in-Picture", mode: "float" },
      { wmClass: "Google-chrome", wmTitle: "Picture-in-Picture", mode: "tile" },
    ]);
    const pip = createMockWindow({
      wm_class: "Google-chrome",
      title: "Picture-in-Picture",
      window_type: WindowType.NORMAL,
      allows_resize: true,
    });
    expect(wm().isFloatingExempt(pip)).toBe(false);
  });

  it("does not over-match a normal Chrome window with the title float rule", () => {
    setOverrides([
      { wmClass: "Google-chrome", mode: "tile" },
      { wmTitle: "Picture-in-Picture", mode: "float" },
    ]);
    const normal = createMockWindow({
      wm_class: "Google-chrome",
      title: "YouTube - Google Chrome",
      window_type: WindowType.NORMAL,
      allows_resize: true,
    });
    expect(wm().isFloatingExempt(normal)).toBe(false);
  });
});
