import { describe, it, expect, vi } from "vitest";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * Bug forge-pu64 (audit-2026-07 / C18): _importCss() calls load_contents(null) with
 * no try/catch — the forge-lid6 try wrapped only parse(). load_contents THROWS a
 * GError on EACCES/EIO (e.g. an unreadable root-owned stylesheet), so the GError
 * propagates out of the ThemeManagerBase constructor -> enable() aborts into ERROR
 * state on every launch (no WindowManager/keybindings/tiling; prefs won't open).
 *
 * Fix: guard the read; fall back to the default stylesheet.
 */
const defaultCss = `.tiled { color: rgba(1,1,1,1); border-width: 3px; opacity: 0.8; }`;

describe("Bug forge-pu64: unreadable stylesheet does not abort enable()", () => {
  const gerror = () => {
    throw new Error("GLib.Error g-io-error-quark: Permission denied (EACCES)");
  };

  function configMgr({ userThrows }) {
    const userFile = new File("/mock/user.css");
    userFile.load_contents = userThrows
      ? vi.fn(gerror)
      : vi.fn(() => [true, new TextEncoder().encode(defaultCss), null]);
    userFile.get_parent = () => ({ get_path: () => "/mock" });

    const defFile = new File("/mock/default.css");
    defFile.load_contents = vi.fn(() => [true, new TextEncoder().encode(defaultCss), null]);
    defFile.get_parent = () => ({ get_path: () => "/mock" });

    return { stylesheetFile: userFile, defaultStylesheetFile: defFile };
  }

  it("does not throw and falls back to the default when load_contents raises GError", () => {
    const settings = new Settings();
    settings.set_uint("css-last-update", 0);

    let theme;
    expect(() => {
      theme = new ThemeManagerBase({ configMgr: configMgr({ userThrows: true }), settings });
    }).not.toThrow();

    // Fell back to the default stylesheet, so the palette is still populated.
    expect(theme.cssAst).toBeDefined();
    expect(theme.cssAst.stylesheet).toBeDefined();
  });
});
