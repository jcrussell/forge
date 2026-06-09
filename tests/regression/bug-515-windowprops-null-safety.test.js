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

/**
 * Bug forge-3sv2: windowProps setter loses the first override on a fresh install.
 *
 * On a fresh profile the windowConfigFile getter delegates to loadFile(), which
 * creates ~/.config/forge/config/windows.json but returns null. The old setter
 * then fell back to defaultWindowConfigFile — the read-only bundled install file —
 * so _saveJsonConfig's replace_contents threw, was swallowed, and the user's first
 * override was silently lost. The setter must always write to the user config path
 * (mirroring the settingsProps / keybindingsProps setters), never the bundled default.
 */
describe("forge-3sv2: windowProps setter persists the first override on a fresh install", () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigManager({ dir: { get_path: () => "/test/extension/path" } });
  });

  it("writes to the user config path, not the read-only bundled default", () => {
    // Fresh install: loadFile() created the user file but returned null, so the
    // getter yields null — the exact condition that triggered the fallback.
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => null,
      configurable: true,
    });
    // The bundled default lives in the read-only extension install dir.
    const readOnlyDefault = new File("/test/extension/path/config/windows.json");
    readOnlyDefault._writable = false;
    Object.defineProperty(configManager, "defaultWindowConfigFile", {
      get: () => readOnlyDefault,
      configurable: true,
    });

    // Capture which file the setter actually targets.
    let savedFile = null;
    const origSave = configManager._saveJsonConfig.bind(configManager);
    configManager._saveJsonConfig = (file, props, name, indent) => {
      savedFile = file;
      return origSave(file, props, name, indent);
    };

    configManager.windowProps = { overrides: [{ wmClass: "Anki", mode: "float" }] };

    // The override must land on the writable user path, never the read-only default.
    expect(savedFile).not.toBeNull();
    expect(savedFile.get_path()).toBe("/home/test/.config/forge/config/windows.json");
    expect(savedFile.get_path()).not.toBe(readOnlyDefault.get_path());
    expect(savedFile._writable).toBe(true);
  });
});
