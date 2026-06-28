import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigManager } from "../../lib/shared/settings.js";
import { File } from "../mocks/gnome/Gio.js";

/**
 * Regression tests for config file robustness.
 *
 * Ensures the extension handles corrupted, invalid, or unexpected
 * config file states gracefully without crashing.
 */

function createMockDir(path = "/mock/extension") {
  return { get_path: () => path };
}

function createMockFile(path, options = {}) {
  const file = new File(path);
  if (options.exists !== undefined) {
    file.query_exists = vi.fn(() => options.exists);
  }
  if (options.contents !== undefined) {
    const encoded = new TextEncoder().encode(options.contents);
    file.load_contents = vi.fn(() => [true, encoded, null]);
  }
  if (options.loadFails) {
    file.load_contents = vi.fn(() => [false, null, null]);
  }
  file.replace_contents = vi.fn(() => [true, null]);
  file.get_parent = vi.fn(() => ({ get_path: () => "/mock/config" }));
  return file;
}

describe("Config robustness: corrupted windows.json", () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigManager({ dir: createMockDir() });
  });

  // forge-96e (#515): windowProps now always yields an overrides-safe shape so
  // callers can deref `.overrides` without crashing. The raw null/{}/array
  // results stay observable through _loadJsonConfig (see bug-415 tests).
  it("should handle truncated JSON gracefully", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: '{ "overrides": [{ "wmClass": "firefox"',
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(props.overrides).toEqual([]);
  });

  it("should handle empty JSON object", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: "{}",
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(props.overrides).toEqual([]);
  });

  it("should handle JSON with unexpected structure", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: '{"unexpected_key": 42}',
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(props).toBeDefined();
    expect(Array.isArray(props.overrides)).toBe(true);
  });

  it("should handle JSON array instead of object", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: '["not", "an", "object"]',
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(Array.isArray(props.overrides)).toBe(true);
  });

  it("should handle whitespace-only file", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: "   \n\t  \n  ",
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(props.overrides).toEqual([]);
  });

  it("should handle file with BOM character", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: '\uFEFF{"overrides": []}',
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    // BOM may make JSON.parse throw; #515 guarantees windowProps still yields a
    // usable shape either way. Asserting only "null or object" could never fail
    // (the getter always returns an object) — pin the real contract: an overrides
    // array. Whether the BOM is stripped-and-parsed or falls back, overrides is [].
    const props = configManager.windowProps;
    expect(Array.isArray(props.overrides)).toBe(true);
    expect(props.overrides).toEqual([]);
  });
});

describe("Config robustness: invalid overrides", () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigManager({ dir: createMockDir() });
  });

  it("should handle overrides with missing wmClass", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: JSON.stringify({
        overrides: [{ mode: "float" }],
      }),
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(props.overrides).toHaveLength(1);
    expect(props.overrides[0].wmClass).toBeUndefined();
  });

  it("should handle overrides with null values", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: JSON.stringify({
        overrides: [{ wmClass: null, mode: null }],
      }),
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(props.overrides).toHaveLength(1);
  });

  it("should handle overrides with unknown mode", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: JSON.stringify({
        overrides: [{ wmClass: "firefox", mode: "nonexistent" }],
      }),
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(props.overrides).toHaveLength(1);
    expect(props.overrides[0].mode).toBe("nonexistent");
  });

  it("should handle empty overrides array", () => {
    const mockFile = createMockFile("/config/windows.json", {
      contents: JSON.stringify({ overrides: [] }),
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(props.overrides).toEqual([]);
  });

  it("should handle very large overrides array", () => {
    const largeOverrides = Array.from({ length: 1000 }, (_, i) => ({
      wmClass: `App${i}`,
      mode: "float",
    }));
    const mockFile = createMockFile("/config/windows.json", {
      contents: JSON.stringify({ overrides: largeOverrides }),
    });
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => mockFile,
      configurable: true,
    });

    const props = configManager.windowProps;
    expect(props.overrides).toHaveLength(1000);
  });
});

describe("Config robustness: _loadJsonConfig", () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigManager({ dir: createMockDir() });
  });

  it("should return null for null config file", () => {
    const result = configManager._loadJsonConfig(null, "test.json");
    expect(result).toBeNull();
  });

  it("should return null for empty file contents", () => {
    const mockFile = createMockFile("/config/test.json", { contents: "" });
    const result = configManager._loadJsonConfig(mockFile, "test.json");
    expect(result).toBeNull();
  });

  it("should return null for invalid JSON", () => {
    const mockFile = createMockFile("/config/test.json", { contents: "not json" });
    const result = configManager._loadJsonConfig(mockFile, "test.json");
    expect(result).toBeNull();
  });

  it("should parse valid JSON correctly", () => {
    const mockFile = createMockFile("/config/test.json", {
      contents: '{"key": "value"}',
    });
    const result = configManager._loadJsonConfig(mockFile, "test.json");
    expect(result).toEqual({ key: "value" });
  });

  it("should return null when file load fails", () => {
    const mockFile = createMockFile("/config/test.json", { loadFails: true });
    const result = configManager._loadJsonConfig(mockFile, "test.json");
    expect(result).toBeNull();
  });
});
