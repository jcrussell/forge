import { describe, it, expect, beforeEach } from "vitest";
import { ConfigManager } from "../../lib/shared/settings.js";
import { File } from "../mocks/gnome/Gio.js";

/**
 * Bug #515 (forge-96e): empty/corrupt windows.json crashes tiling and prefs.
 *
 * _loadJsonConfig() returns null on empty/invalid JSON (good), but the
 * `windowProps` getter passed that null straight through. Every caller derefs
 * `.overrides` — isFloatingExempt (window.js:3046), reloadWindowOverrides
 * (window.js:3197), and the Floating prefs page (floating.js:64) — so a null
 * (or a parsed value without an `overrides` array) throws TypeError and breaks
 * all tiling. The original gh-515 crash (`JSON.parse` at the getter) simply
 * relocated downstream once _loadJsonConfig was hardened.
 *
 * Fix: windowProps always returns an object whose `.overrides` is an array, and
 * loadDefaultWindowConfigContents (used by the prefs "Reset" button) is routed
 * through the guarded loader instead of an unguarded JSON.parse.
 */
describe("Bug #515: windowProps is always overrides-safe", () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigManager({ dir: { get_path: () => "/test/extension/path" } });
  });

  function mockFileWithContents(contents) {
    const file = new File("/config/windows.json");
    const encoded = new TextEncoder().encode(contents);
    file.load_contents = () => [true, encoded, null];
    return file;
  }

  function useWindowConfig(contents) {
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFileWithContents(contents),
      configurable: true,
    });
  }

  // The crash callers do: windowProps.overrides.filter(...). Must never throw.
  function derefLikeCallers() {
    return configManager.windowProps.overrides.filter(() => true);
  }

  it("returns an overrides array for an empty file (was null)", () => {
    useWindowConfig("");
    expect(() => derefLikeCallers()).not.toThrow();
    expect(Array.isArray(configManager.windowProps.overrides)).toBe(true);
  });

  it("returns an overrides array for truncated JSON", () => {
    useWindowConfig('{ "overrides": [');
    expect(() => derefLikeCallers()).not.toThrow();
    expect(configManager.windowProps.overrides).toEqual([]);
  });

  it("returns an overrides array for a structurally valid file lacking overrides", () => {
    useWindowConfig('{ "unexpected_key": 42 }');
    expect(Array.isArray(configManager.windowProps.overrides)).toBe(true);
  });

  it("returns an overrides array when the JSON is an array", () => {
    useWindowConfig('["not", "an", "object"]');
    expect(() => derefLikeCallers()).not.toThrow();
    expect(Array.isArray(configManager.windowProps.overrides)).toBe(true);
  });

  it("preserves real overrides when the file is valid", () => {
    useWindowConfig(JSON.stringify({ overrides: [{ wmClass: "Anki", mode: "tile" }] }));
    expect(configManager.windowProps.overrides).toHaveLength(1);
    expect(configManager.windowProps.overrides[0].wmClass).toBe("Anki");
  });

  it("loadDefaultWindowConfigContents never throws/returns a non-overrides shape on a corrupt default", () => {
    // The prefs 'Reset' button (floating.js onResetHandler) derefs .overrides.
    Object.defineProperty(configManager, "defaultWindowConfigFile", {
      get: () => mockFileWithContents('{ "overrides": ['),
      configurable: true,
    });
    let result;
    expect(() => {
      result = configManager.loadDefaultWindowConfigContents();
    }).not.toThrow();
    expect(Array.isArray(result.overrides)).toBe(true);
  });
});
