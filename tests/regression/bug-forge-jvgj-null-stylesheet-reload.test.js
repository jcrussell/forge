import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import St from "gi://St";
import { File } from "../mocks/gnome/Gio.js";
import { ExtensionThemeManager } from "../../lib/extension/extension-theme-manager.js";

/**
 * Bug forge-jvgj (audit-2026-07b): reloadStylesheet() unloaded
 * defaultStylesheetFile and then passed configMgr.stylesheetFile straight to
 * unload_stylesheet() with no null guard. ConfigManager.loadFile() returns null
 * when the profile file is absent and seeding throws — read-only $HOME, a
 * root-owned ~/.config/forge, a full disk — the state theme.js already documents
 * for forge-0h9k.
 *
 * st_theme_unload_stylesheet(StTheme*, GFile *file) carries no (nullable)
 * annotation, so GJS throws. The default had already been unloaded one line
 * earlier and the catch swallowed the throw, so NO Forge stylesheet was loaded
 * at all: no focus border, no tab-bar/stacked-bar styling, no drop preview,
 * while tiling kept working. this.stylesheet was left unset too, so
 * unloadStylesheet() on disable became a no-op.
 *
 * Fix: resolve through the same defaultStylesheetFile fallback
 * ThemeManagerBase._getStylesheetFile() implements, and null-guard both unloads.
 */
let mockProduction = true;
vi.mock("../../lib/shared/settings.js", () => ({
  get production() {
    return mockProduction;
  },
  PERMISSIONS_MODE: 0o744,
}));

const sampleCss = `.tiled { color: rgba(255,255,255,0.8); border-width: 1px; opacity: 0.8; }`;

function createMockStylesheetFile(path) {
  const file = new File(path);
  file.load_contents = vi.fn(() => [true, new TextEncoder().encode(sampleCss), null]);
  file.get_parent = vi.fn(() => ({ get_path: () => "/mock" }));
  return file;
}

describe("Bug forge-jvgj: a null user stylesheet must not strip all Forge styling", () => {
  let theme;
  let defaultStylesheetFile;

  beforeEach(() => {
    // Model the real St API: both calls take a non-nullable GFile, so GJS throws
    // on null rather than quietly accepting it (tests/README.md — a mock that
    // doesn't match the actual API can't reproduce the failure).
    const rejectNull = (name) =>
      vi.fn((file) => {
        if (file === null || file === undefined) {
          throw new TypeError(`Expected argument of type Gio.File for ${name}, got ${file}`);
        }
      });
    theme = {
      load_stylesheet: rejectNull("load_stylesheet"),
      unload_stylesheet: rejectNull("unload_stylesheet"),
    };
    vi.spyOn(St.ThemeContext, "get_for_stage").mockReturnValue({ get_theme: () => theme });
    defaultStylesheetFile = createMockStylesheetFile("/mock/default-stylesheet.css");
    mockProduction = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeManager(stylesheetFile) {
    return new ExtensionThemeManager({
      metadata: { uuid: "forge@jmmaranan.com" },
      configMgr: { stylesheetFile, defaultStylesheetFile },
      settings: {},
    });
  }

  it("falls back to the bundled default when the profile stylesheet is null", () => {
    const mgr = makeManager(null);

    mgr.reloadStylesheet();

    expect(theme.load_stylesheet).toHaveBeenCalledWith(defaultStylesheetFile);
    expect(mgr.stylesheet).toBe(defaultStylesheetFile);
  });

  it("leaves disable() able to unload what it loaded", () => {
    const mgr = makeManager(null);
    mgr.reloadStylesheet();

    expect(() => mgr.unloadStylesheet()).not.toThrow();
    expect(theme.unload_stylesheet).toHaveBeenCalledWith(defaultStylesheetFile);
    expect(mgr.stylesheet).toBeNull();
  });

  it("loads the default on the dev branch even when the profile stylesheet is null", () => {
    mockProduction = false;
    const mgr = makeManager(null);

    mgr.reloadStylesheet();

    expect(theme.load_stylesheet).toHaveBeenCalledWith(defaultStylesheetFile);
    expect(mgr.stylesheet).toBe(defaultStylesheetFile);
  });

  it("still loads the user stylesheet when it exists", () => {
    const stylesheetFile = createMockStylesheetFile("/mock/stylesheet.css");
    const mgr = makeManager(stylesheetFile);

    mgr.reloadStylesheet();

    expect(theme.load_stylesheet).toHaveBeenCalledWith(stylesheetFile);
    expect(mgr.stylesheet).toBe(stylesheetFile);
  });
});
