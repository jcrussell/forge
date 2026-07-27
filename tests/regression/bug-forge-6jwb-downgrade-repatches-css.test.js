import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * forge-6jwb: patchCss() overwrites stylesheet.css.bak with the CURRENT default
 * before installing it, so .bak is the only surviving copy of the user's
 * customizations. _needUpdate() used `!==`, which also fired on a DOWNGRADE
 * (stored css-last-update 38, cssTag 37) — installing an older Forge after an
 * upgrade replaced the user's saved CSS with the newer default and destroyed it.
 *
 * Only a forward tag bump may re-patch.
 */

const sampleCss = `
.tiled { color: rgba(255,255,255,0.8); border-width: 3px; opacity: 0.8; }
.split { color: rgba(200,200,200,0.7); border-width: 2px; opacity: 0.7; }
.floated { color: rgba(150,150,150,0.6); border-width: 1px; opacity: 0.6; }
.stacked { color: rgba(100,100,100,0.5); border-width: 4px; opacity: 0.5; }
.tabbed { color: rgba(50,50,50,0.4); border-width: 5px; opacity: 0.4; }
`;

function createThemeManager(storedTag) {
  const stylesheet = new File("/mock/stylesheet.css");
  stylesheet.load_contents = vi.fn(() => [true, new TextEncoder().encode(sampleCss), null]);
  stylesheet.replace_contents = vi.fn(() => [true, null]);
  stylesheet.copy = vi.fn(() => true);
  stylesheet.get_parent = vi.fn(() => ({ get_path: () => "/mock" }));

  const settings = new Settings();
  settings.set_uint("css-last-update", storedTag);

  const theme = new ThemeManagerBase({
    configMgr: {
      stylesheetFile: stylesheet,
      defaultStylesheetFile: stylesheet,
      stylesheetFileName: "/mock/stylesheet.css",
    },
    settings,
  });

  // copy() is called twice per patch: user CSS -> .bak, then default -> user CSS.
  // Reset after construction so the spy only sees patchCss() activity.
  stylesheet.copy.mockClear();
  return { theme, settings, stylesheet };
}

describe("forge-6jwb: patchCss must not fire on a downgrade", () => {
  let shippedTag;

  beforeEach(() => {
    // Read the real tag rather than hardcoding it, so this test keeps working
    // across future bumps.
    shippedTag = createThemeManager(0).theme.cssTag;
  });

  it("does not touch the stylesheet or its .bak when the stored tag is NEWER", () => {
    const { theme, settings, stylesheet } = createThemeManager(shippedTag + 1);

    expect(theme.patchCss()).toBe(false);

    // The decisive assertion: .bak must not be overwritten with the older default.
    expect(stylesheet.copy).not.toHaveBeenCalled();
    // And the newer stamp must survive, so a later re-upgrade still no-ops.
    expect(settings.get_uint("css-last-update")).toBe(shippedTag + 1);
  });

  it("still patches on a genuine upgrade (positive control)", () => {
    const { theme, settings, stylesheet } = createThemeManager(shippedTag - 1);

    expect(theme.patchCss()).toBe(true);
    // Both copies run: user CSS -> .bak, default -> user CSS.
    expect(stylesheet.copy).toHaveBeenCalledTimes(2);
    expect(settings.get_uint("css-last-update")).toBe(shippedTag);
  });

  it("no-ops when already at the shipped tag", () => {
    const { theme, stylesheet } = createThemeManager(shippedTag);

    expect(theme.patchCss()).toBe(false);
    expect(stylesheet.copy).not.toHaveBeenCalled();
  });
});
