import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import St from "gi://St";
import { File } from "../../mocks/gnome/Gio.js";
import { ExtensionThemeManager } from "../../../lib/extension/extension-theme-manager.js";
import { Logger } from "../../../lib/shared/logger.js";

// reloadStylesheet() branches on `production` (true = load the user's custom
// stylesheet, false = the bundled default). The source's named import is a live
// binding, so a getter lets each test pick the branch. The `mock` prefix opts the
// holder past vitest's hoisted-factory variable restriction. PERMISSIONS_MODE is
// re-exported because shared/theme.js (ThemeManagerBase) also imports it.
let mockProduction = true;
vi.mock("../../../lib/shared/settings.js", () => ({
  get production() {
    return mockProduction;
  },
  PERMISSIONS_MODE: 0o744,
}));

// Minimal CSS so ThemeManagerBase._importCss() succeeds in the constructor.
const sampleCss = `.tiled { color: rgba(255,255,255,0.8); border-width: 1px; opacity: 0.8; }`;

function createMockStylesheetFile(path) {
  const file = new File(path);
  file.load_contents = vi.fn(() => [true, new TextEncoder().encode(sampleCss), null]);
  file.get_parent = vi.fn(() => ({ get_path: () => "/mock" }));
  return file;
}

/**
 * forge-wwn8: the manually loaded stylesheet was never unloaded on disable().
 * reloadStylesheet() loads via theme.load_stylesheet() and remembers it in
 * this.stylesheet, but the only unload_stylesheet calls lived inside
 * reloadStylesheet itself (run on the NEXT enable). unloadStylesheet() lets
 * disable() release the currently-loaded stylesheet so theme state isn't leaked.
 */
describe("forge-wwn8: ExtensionThemeManager.unloadStylesheet", () => {
  let theme;
  let mgr;

  beforeEach(() => {
    // Stable theme object so load/unload calls are observable.
    theme = {
      load_stylesheet: vi.fn(),
      unload_stylesheet: vi.fn(),
    };
    vi.spyOn(St.ThemeContext, "get_for_stage").mockReturnValue({
      get_theme: () => theme,
    });

    const stylesheetFile = createMockStylesheetFile("/mock/stylesheet.css");
    const defaultStylesheetFile = createMockStylesheetFile("/mock/default-stylesheet.css");

    const extension = {
      metadata: { uuid: "forge@jmmaranan.com" },
      configMgr: { stylesheetFile, defaultStylesheetFile },
      settings: {},
    };

    mgr = new ExtensionThemeManager(extension);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("unloads the currently-loaded stylesheet", () => {
    mgr.reloadStylesheet();
    const loaded = mgr.stylesheet;
    expect(loaded).toBeTruthy();

    theme.unload_stylesheet.mockClear();
    mgr.unloadStylesheet();

    expect(theme.unload_stylesheet).toHaveBeenCalledWith(loaded);
  });

  it("does nothing when no stylesheet is loaded", () => {
    mgr.unloadStylesheet();
    expect(theme.unload_stylesheet).not.toHaveBeenCalled();
  });

  it("clears the remembered handle so a second unload is a no-op", () => {
    mgr.reloadStylesheet();
    expect(mgr.stylesheet).toBeTruthy();

    mgr.unloadStylesheet();
    expect(mgr.stylesheet).toBeNull();

    // A second disable() (or double-unload) must not release an already-freed
    // handle — without clearing this.stylesheet it would unload_stylesheet twice.
    theme.unload_stylesheet.mockClear();
    mgr.unloadStylesheet();
    expect(theme.unload_stylesheet).not.toHaveBeenCalled();
  });
});

describe("ExtensionThemeManager.reloadStylesheet", () => {
  let theme;
  let mgr;
  let stylesheetFile;
  let defaultStylesheetFile;

  beforeEach(() => {
    mockProduction = true;
    theme = {
      load_stylesheet: vi.fn(),
      unload_stylesheet: vi.fn(),
    };
    vi.spyOn(St.ThemeContext, "get_for_stage").mockReturnValue({
      get_theme: () => theme,
    });

    stylesheetFile = createMockStylesheetFile("/mock/stylesheet.css");
    defaultStylesheetFile = createMockStylesheetFile("/mock/default-stylesheet.css");

    const extension = {
      metadata: { uuid: "forge@jmmaranan.com" },
      configMgr: { stylesheetFile, defaultStylesheetFile },
      settings: {},
    };

    mgr = new ExtensionThemeManager(extension);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the user's custom stylesheet in production", () => {
    mockProduction = true;
    mgr.reloadStylesheet();

    expect(theme.load_stylesheet).toHaveBeenCalledTimes(1);
    expect(theme.load_stylesheet).toHaveBeenCalledWith(stylesheetFile);
    expect(mgr.stylesheet).toBe(stylesheetFile);
  });

  it("loads the bundled default stylesheet in development", () => {
    mockProduction = false;
    mgr.reloadStylesheet();

    expect(theme.load_stylesheet).toHaveBeenCalledTimes(1);
    expect(theme.load_stylesheet).toHaveBeenCalledWith(defaultStylesheetFile);
    expect(mgr.stylesheet).toBe(defaultStylesheetFile);
  });

  it("unloads both default and custom stylesheets before loading (forge-wwn8 leak guard)", () => {
    mgr.reloadStylesheet();

    expect(theme.unload_stylesheet).toHaveBeenCalledWith(defaultStylesheetFile);
    expect(theme.unload_stylesheet).toHaveBeenCalledWith(stylesheetFile);
  });

  it("leaves state consistent and logs when load_stylesheet throws", () => {
    const errorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
    theme.load_stylesheet = vi.fn(() => {
      throw new Error("theme refused stylesheet");
    });

    expect(() => mgr.reloadStylesheet()).not.toThrow();

    // The catch returns before assigning this.stylesheet, so no stale handle is
    // left for a later unloadStylesheet() to release incorrectly.
    expect(mgr.stylesheet).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
