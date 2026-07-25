import { describe, it, expect, vi } from "vitest";
import { parse } from "../../lib/css/index.js";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * Bug forge-y3jy (audit-2026-07b): rules() stops at an unmatched top-level '}'
 * and stylesheet() never checked that the input was consumed, so a stray brace
 * truncated the AST with an EMPTY parsingErrors list. stringify() then succeeded
 * on the truncation and _updateCss() wrote it back over the user's
 * ~/.config/forge/stylesheet/forge/stylesheet.css — silently deleting every rule
 * after the stray brace. patchCss() is the only .bak writer and only on a cssTag
 * bump, so there is no per-write backup to recover from.
 *
 * Fix: record a parse error when input remains after rules(), and have
 * _updateCss() refuse to write (returning false) when parsingErrors is non-empty.
 */
const truncatingCss = `.window-tiled-border { border-color: rgba(1,2,3,1); }
}
.window-floated-border { border-color: rgba(4,5,6,1); }
.window-tabbed-border { border-color: rgba(7,8,9,1); }`;

describe("Bug forge-y3jy: a stray '}' truncates the stylesheet and the write destroys it", () => {
  it("records a parse error when the input is not fully consumed", () => {
    const ast = parse(truncatingCss, { silent: true });

    // Only the first rule survives the parse — that part is inherent to the
    // scanner. What must NOT happen is it going unreported.
    expect(ast.stylesheet.rules).toHaveLength(1);
    expect(ast.stylesheet.parsingErrors.length).toBeGreaterThan(0);
  });

  it("still reports no errors for a well-formed stylesheet", () => {
    const ast = parse(truncatingCss.replace("}\n.window-floated", ".window-floated"), {
      silent: true,
    });
    expect(ast.stylesheet.parsingErrors).toHaveLength(0);
  });

  function makeTheme(css) {
    const file = new File("/mock/stylesheet.css");
    file.load_contents = vi.fn(() => [true, new TextEncoder().encode(css), null]);
    file.get_parent = () => ({ get_path: () => "/mock" });
    file.replace_contents = vi.fn(() => [true, null]);

    const settings = new Settings();
    settings.set_uint("css-last-update", 0);
    const theme = new ThemeManagerBase({
      configMgr: { stylesheetFile: file, defaultStylesheetFile: file },
      settings,
    });
    theme.reloadStylesheet = vi.fn();
    return { theme, file };
  }

  it("refuses to overwrite the user stylesheet when the parse reported errors", () => {
    const { theme, file } = makeTheme(truncatingCss);

    const ok = theme.setCssProperty(".window-tiled-border", "border-color", "rgba(9,9,9,1)");

    expect(file.replace_contents).not.toHaveBeenCalled();
    expect(ok).toBe(false);
    expect(theme.reloadStylesheet).not.toHaveBeenCalled();
  });

  it("still writes when the stylesheet parsed cleanly", () => {
    const { theme, file } = makeTheme(
      `.window-tiled-border { border-color: rgba(1,2,3,1); }
.window-floated-border { border-color: rgba(4,5,6,1); }`
    );

    const ok = theme.setCssProperty(".window-tiled-border", "border-color", "rgba(9,9,9,1)");

    expect(ok).toBe(true);
    expect(file.replace_contents).toHaveBeenCalled();
    const written = new TextDecoder().decode(file.replace_contents.mock.calls[0][0]);
    // The rule after the edited one must survive the round-trip.
    expect(written).toContain(".window-floated-border");
  });
});
