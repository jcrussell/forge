import { describe, it, expect, vi } from "vitest";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * Bug forge-d59z (audit-2026-07 / C20): _updateCss() relied on replace_contents
 * returning success=false, but GJS replace_contents THROWS a GError on failure — the
 * else/Logger.error branch was dead code and there was no try/catch. A root-owned /
 * unwritable stylesheet made the GError escape setCssProperty into the prefs GTK
 * handler, aborting updateCssColors mid-handler (later setCssProperty calls skipped,
 * color change silently lost, AST out of sync with disk).
 *
 * Fix: wrap replace_contents in try/catch (and log, not silently skip, a mkdir
 * failure).
 */
const sampleCss = `.tiled { color: rgba(255,255,255,0.8); border-width: 3px; opacity: 0.8; }`;

describe("Bug forge-d59z: _updateCss swallows a replace_contents GError", () => {
  function makeTheme({ replaceThrows }) {
    const file = new File("/mock/stylesheet.css");
    file.load_contents = vi.fn(() => [true, new TextEncoder().encode(sampleCss), null]);
    file.get_parent = () => ({ get_path: () => "/mock" });
    file.replace_contents = replaceThrows
      ? vi.fn(() => {
          throw new Error("GLib.Error g-io-error-quark: Permission denied");
        })
      : vi.fn(() => [true, null]);

    const settings = new Settings();
    settings.set_uint("css-last-update", 0);
    const theme = new ThemeManagerBase({
      configMgr: { stylesheetFile: file, defaultStylesheetFile: file },
      settings,
    });
    theme.reloadStylesheet = vi.fn();
    return { theme, file };
  }

  it("does not throw when replace_contents raises a GError", () => {
    const { theme } = makeTheme({ replaceThrows: true });
    expect(() => theme.setCssProperty(".tiled", "color", "red")).not.toThrow();
    // The write failed, so the stylesheet was not reloaded.
    expect(theme.reloadStylesheet).not.toHaveBeenCalled();
  });

  it("still writes and reloads on the happy path", () => {
    const { theme, file } = makeTheme({ replaceThrows: false });
    expect(() => theme.setCssProperty(".tiled", "opacity", "0.9")).not.toThrow();
    expect(file.replace_contents).toHaveBeenCalled();
    expect(theme.reloadStylesheet).toHaveBeenCalled();
  });
});
