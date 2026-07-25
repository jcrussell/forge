import { describe, it, expect, vi } from "vitest";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * Bug forge-rohk (audit-2026-07b): setCssProperty assigned cssProperty.value
 * BEFORE _updateCss(), and _updateCss() correctly swallows the replace_contents
 * GError (forge-d59z) but never rolled the AST back. Combined with the
 * forge-w3ss idempotency short-circuit — `if (cssProperty.value ===
 * propertyValue) return true` — retrying the same color after fixing the
 * permission problem returned true with NO write attempted, so the disk stayed
 * stale for the life of the prefs process.
 *
 * Fix: _updateCss() returns a success boolean; setCssProperty restores the
 * previous value and returns false when the write fails.
 */
const sampleCss = `.tiled { color: rgba(255,255,255,0.8); opacity: 0.8; }`;

describe("Bug forge-rohk: a failed write leaves the AST dirty and the retry no-ops", () => {
  function makeTheme() {
    const file = new File("/mock/stylesheet.css");
    file.load_contents = vi.fn(() => [true, new TextEncoder().encode(sampleCss), null]);
    file.get_parent = () => ({ get_path: () => "/mock" });
    let failing = true;
    file.replace_contents = vi.fn(() => {
      if (failing) throw new Error("GLib.Error g-io-error-quark: Permission denied");
      return [true, null];
    });

    const settings = new Settings();
    settings.set_uint("css-last-update", 0);
    const theme = new ThemeManagerBase({
      configMgr: { stylesheetFile: file, defaultStylesheetFile: file },
      settings,
    });
    theme.reloadStylesheet = vi.fn();
    return { theme, file, heal: () => (failing = false) };
  }

  it("reports failure and rolls the AST back when the write throws", () => {
    const { theme } = makeTheme();

    const ok = theme.setCssProperty(".tiled", "color", "red");

    expect(ok).toBe(false);
    expect(theme.getCssProperty(".tiled", "color").value).toBe("rgba(255,255,255,0.8)");
  });

  it("re-attempts the identical write after the failure is fixed", () => {
    const { theme, file, heal } = makeTheme();

    expect(theme.setCssProperty(".tiled", "color", "red")).toBe(false);
    heal();
    // Same value as the failed attempt: the forge-w3ss short-circuit must not
    // treat it as already-persisted.
    expect(theme.setCssProperty(".tiled", "color", "red")).toBe(true);

    expect(file.replace_contents).toHaveBeenCalledTimes(2);
    expect(new TextDecoder().decode(file.replace_contents.mock.calls[1][0])).toContain(
      "color: red"
    );
    expect(theme.getCssProperty(".tiled", "color").value).toBe("red");
  });

  it("still short-circuits a genuinely redundant write", () => {
    const { theme, file, heal } = makeTheme();
    heal();

    expect(theme.setCssProperty(".tiled", "opacity", "0.9")).toBe(true);
    expect(file.replace_contents).toHaveBeenCalledTimes(1);
    // Nothing changed, so no second write.
    expect(theme.setCssProperty(".tiled", "opacity", "0.9")).toBe(true);
    expect(file.replace_contents).toHaveBeenCalledTimes(1);
  });
});
