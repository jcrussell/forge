import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import St from "gi://St";
import { File } from "../../mocks/gnome/Gio.js";
import { ExtensionThemeManager } from "../../../lib/extension/extension-theme-manager.js";

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
});
