import { describe, it, expect, beforeEach } from "vitest";
import { ConfigManager } from "../../lib/shared/settings.js";
import { File } from "../mocks/gnome/Gio.js";

/**
 * Bug #415: Extension fails to load with corrupt/empty windows.json
 *
 * Problem: When windows.json config file is empty or contains invalid JSON,
 * the extension fails to load with a JSON.parse error:
 * "unexpected end of data at line 1 column 1"
 *
 * Fix: ConfigManager._loadJsonConfig() wraps parsing in try/catch and treats
 * empty/whitespace content as missing, returning null instead of throwing.
 *
 * These tests exercise the real ConfigManager._loadJsonConfig()
 * (lib/shared/settings.js).
 */
describe("Bug #415: Graceful handling of corrupt/empty config files", () => {
  let configManager;

  beforeEach(() => {
    const mockDir = { get_path: () => "/test/extension/path" };
    configManager = new ConfigManager({ dir: mockDir });
  });

  // Build a mock Gio.File whose load_contents() yields the given string.
  function mockFileWithContents(contents) {
    const file = new File("/config/windows.json");
    const encoded = new TextEncoder().encode(contents);
    file.load_contents = () => [true, encoded, null];
    return file;
  }

  it("returns null for a null config file (no throw)", () => {
    expect(() => configManager._loadJsonConfig(null, "windows.json")).not.toThrow();
    expect(configManager._loadJsonConfig(null, "windows.json")).toBeNull();
  });

  it("returns null for an empty file", () => {
    const file = mockFileWithContents("");
    let result;
    expect(() => {
      result = configManager._loadJsonConfig(file, "windows.json");
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it("returns null for a whitespace-only file", () => {
    const file = mockFileWithContents("   \n\t   ");
    let result;
    expect(() => {
      result = configManager._loadJsonConfig(file, "windows.json");
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    const file = mockFileWithContents('{ "overrides": [');
    let result;
    expect(() => {
      result = configManager._loadJsonConfig(file, "windows.json");
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const file = mockFileWithContents("not valid json");
    let result;
    expect(() => {
      result = configManager._loadJsonConfig(file, "windows.json");
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it("returns null when load_contents reports failure", () => {
    const file = new File("/config/windows.json");
    file.load_contents = () => [false, null, null];
    let result;
    expect(() => {
      result = configManager._loadJsonConfig(file, "windows.json");
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it("parses a valid JSON object", () => {
    const config = { float: [{ wmClass: "firefox", title: "Picture-in-Picture" }], tile: [] };
    const file = mockFileWithContents(JSON.stringify(config));

    let result;
    expect(() => {
      result = configManager._loadJsonConfig(file, "windows.json");
    }).not.toThrow();
    expect(result).toEqual(config);
  });
});
