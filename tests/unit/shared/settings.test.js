import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../../../lib/shared/settings.js";
import { File } from "../../mocks/gnome/Gio.js";

// Sample window config for testing
const sampleWindowConfig = {
  float: [{ wmClass: "Firefox", title: "Picture-in-Picture" }],
  tile: [],
};

// Create a mock directory object
function createMockDir(path = "/mock/extension") {
  return {
    get_path: () => path,
  };
}

// Create a mock file with configurable behavior
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
  file.make_directory_with_parents = vi.fn(() => true);
  file.create = vi.fn(() => ({
    write_all: vi.fn(() => [true, 0]),
    close: vi.fn(() => true),
  }));

  return file;
}

describe("ConfigManager", () => {
  let configManager;
  let mockDir;

  beforeEach(() => {
    mockDir = createMockDir("/test/extension/path");
    configManager = new ConfigManager({ dir: mockDir });
  });

  describe("confDir", () => {
    it("should return forge config directory under user config", () => {
      const confDir = configManager.confDir;
      expect(confDir).toContain("forge");
      expect(confDir).toContain(".config");
    });

    it("should be consistent across calls", () => {
      const first = configManager.confDir;
      const second = configManager.confDir;
      expect(first).toBe(second);
    });
  });

  describe("defaultStylesheetFile", () => {
    it("should return file when stylesheet exists", () => {
      const file = configManager.defaultStylesheetFile;
      expect(file).not.toBeNull();
    });

    it("should look for stylesheet.css in extension path", () => {
      const file = configManager.defaultStylesheetFile;
      expect(file.get_path()).toContain("stylesheet.css");
      expect(file.get_path()).toContain(configManager.extensionPath);
    });
  });

  describe("stylesheetFile", () => {
    it("should attempt to load custom stylesheet", () => {
      // The default mock reports the custom file exists, so loadFile returns it.
      const file = configManager.stylesheetFile;
      expect(file).not.toBeNull();
      expect(file.get_path()).toContain("stylesheet.css");
    });
  });

  describe("defaultWindowConfigFile", () => {
    it("should return file when config exists", () => {
      const file = configManager.defaultWindowConfigFile;
      expect(file).not.toBeNull();
    });

    it("should look for windows.json in config directory", () => {
      const file = configManager.defaultWindowConfigFile;
      expect(file.get_path()).toContain("windows.json");
      expect(file.get_path()).toContain("config");
    });
  });

  describe("windowConfigFile", () => {
    it("should attempt to load custom window config", () => {
      // The default mock reports the custom file exists, so loadFile returns it.
      const file = configManager.windowConfigFile;
      expect(file).not.toBeNull();
      expect(file.get_path()).toContain("windows.json");
      expect(file.get_path()).toContain("config");
    });
  });

  describe("loadFile", () => {
    it("should return existing custom file", () => {
      const customPath = "/custom/path";
      const fileName = "test.json";
      const defaultFile = createMockFile("/default/test.json");

      const result = configManager.loadFile(customPath, fileName, defaultFile);
      // Mock File.query_exists returns true by default
      expect(result).not.toBeNull();
    });

    it("should return null when custom file does not exist and dir creation fails", () => {
      // Create a scenario where the custom file doesn't exist
      const originalNewForPath = File.new_for_path;

      let callCount = 0;
      vi.spyOn(File, "new_for_path").mockImplementation((path) => {
        callCount++;
        const file = new File(path);
        // First call is for the custom file - make it not exist
        if (callCount === 1) {
          file.query_exists = vi.fn(() => false);
        }
        // Second call is for the directory - make it not exist but fail to create
        if (callCount === 2) {
          file.query_exists = vi.fn(() => false);
          file.make_directory_with_parents = vi.fn(() => false);
        }
        return file;
      });

      const result = configManager.loadFile("/custom", "file.json", null);
      expect(result).toBeNull();

      vi.restoreAllMocks();
    });

    it("should create directory and file when neither exists", () => {
      let callCount = 0;
      const mockStream = {
        write_all: vi.fn(() => [true, 0]),
        close: vi.fn(() => true),
      };

      vi.spyOn(File, "new_for_path").mockImplementation((path) => {
        callCount++;
        const file = new File(path);

        if (callCount === 1) {
          // Custom file - doesn't exist
          file.query_exists = vi.fn(() => false);
          file.create = vi.fn(() => mockStream);
        }
        if (callCount === 2) {
          // Directory - doesn't exist but can be created
          file.query_exists = vi.fn(() => false);
          file.make_directory_with_parents = vi.fn(() => true);
        }
        return file;
      });

      const defaultFile = createMockFile("/default/file.json", {
        contents: '{"test": true}',
      });

      configManager.loadFile("/custom", "file.json", defaultFile);

      expect(mockStream.write_all).toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });

  describe("loadFileContents", () => {
    it("should return file contents as string", () => {
      const mockFile = createMockFile("/test/file.json", {
        contents: '{"key": "value"}',
      });

      const result = configManager.loadFileContents(mockFile);
      expect(result).toBe('{"key": "value"}');
    });

    it("should return undefined when load fails", () => {
      const mockFile = createMockFile("/test/file.json", {
        loadFails: true,
      });

      const result = configManager.loadFileContents(mockFile);
      expect(result).toBeUndefined();
    });
  });

  // forge-f6go: settings.js is a pure ESM module but decoded file bytes via the
  // deprecated legacy global `imports.byteArray.toString`. On any GJS build that
  // drops the legacy module (a real risk on the GNOME 50 target) the call throws,
  // so user windows.json overrides are silently ignored. Simulate that build by
  // removing the legacy global and asserting decoding still works via TextDecoder.
  describe("decoding without the legacy imports.byteArray module (forge-f6go)", () => {
    let savedImports;

    beforeEach(() => {
      savedImports = global.imports;
      delete global.imports;
    });

    afterEach(() => {
      global.imports = savedImports;
    });

    it("loadFileContents decodes UTF-8 bytes (incl. non-ASCII) without imports.byteArray", () => {
      const mockFile = createMockFile("/test/file.json", {
        contents: '{"name": "Café — naïve"}',
      });

      const result = configManager.loadFileContents(mockFile);
      expect(result).toBe('{"name": "Café — naïve"}');
    });

    it("_loadJsonConfig parses UTF-8 JSON (incl. non-ASCII) without imports.byteArray", () => {
      const payload = { tile: [{ wmClass: "Café", title: "naïve—dash" }] };
      const mockFile = createMockFile("/test/windows.json", {
        contents: JSON.stringify(payload),
      });

      const result = configManager._loadJsonConfig(mockFile, "windows.json");
      expect(result).toEqual(payload);
    });
  });

  describe("loadDefaultWindowConfigContents", () => {
    it("should return parsed JSON from default config", () => {
      // Mock the defaultWindowConfigFile getter to return a file with contents
      const mockFile = createMockFile("/default/windows.json", {
        contents: JSON.stringify(sampleWindowConfig),
      });

      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      const result = configManager.loadDefaultWindowConfigContents();
      expect(result).toEqual(sampleWindowConfig);
    });

    // forge-96e (#515): loadDefaultWindowConfigContents now always yields an
    // overrides-safe shape (the prefs "Reset" button derefs .overrides).
    it("returns an overrides-safe shape when no default config file", () => {
      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => null,
        configurable: true,
      });

      const result = configManager.loadDefaultWindowConfigContents();
      expect(result).toEqual({ overrides: [] });
    });

    it("returns an overrides-safe shape when file contents cannot be loaded", () => {
      const mockFile = createMockFile("/default/windows.json", {
        loadFails: true,
      });

      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      const result = configManager.loadDefaultWindowConfigContents();
      expect(result).toEqual({ overrides: [] });
    });
  });

  describe("windowProps getter", () => {
    // forge-96e (#515): the getter guarantees an `overrides` array so callers
    // never crash dereferencing it. A well-formed overrides config passes through.
    const overridesConfig = { overrides: [{ wmClass: "Firefox", mode: "float" }] };

    it("should return parsed window config", () => {
      const mockFile = createMockFile("/config/windows.json", {
        contents: JSON.stringify(overridesConfig),
      });

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      const props = configManager.windowProps;
      expect(props).toEqual(overridesConfig);
    });

    it("should fall back to default when windowConfigFile is null", () => {
      const mockDefaultFile = createMockFile("/default/windows.json", {
        contents: JSON.stringify(overridesConfig),
      });

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => null,
        configurable: true,
      });
      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => mockDefaultFile,
        configurable: true,
      });

      const props = configManager.windowProps;
      expect(props).toEqual(overridesConfig);
    });

    it("returns an overrides-safe shape when load fails", () => {
      const mockFile = createMockFile("/config/windows.json", {
        loadFails: true,
      });

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      const props = configManager.windowProps;
      expect(props).toEqual({ overrides: [] });
    });
  });

  describe("windowProps setter", () => {
    it("should write JSON to config file", () => {
      const mockFile = createMockFile("/config/windows.json");
      mockFile.get_parent = vi.fn(() => ({
        get_path: () => "/config",
      }));

      Object.defineProperty(configManager, "windowConfigPath", {
        get: () => mockFile,
        configurable: true,
      });

      configManager.windowProps = sampleWindowConfig;

      expect(mockFile.replace_contents).toHaveBeenCalled();
      const writtenContents = mockFile.replace_contents.mock.calls[0][0];
      expect(JSON.parse(writtenContents)).toEqual(sampleWindowConfig);
    });

    it("should format JSON with 4-space indentation", () => {
      const mockFile = createMockFile("/config/windows.json");
      mockFile.get_parent = vi.fn(() => ({
        get_path: () => "/config",
      }));

      Object.defineProperty(configManager, "windowConfigPath", {
        get: () => mockFile,
        configurable: true,
      });

      configManager.windowProps = { test: true };

      const writtenContents = mockFile.replace_contents.mock.calls[0][0];
      expect(writtenContents).toContain("    "); // 4-space indent
    });

    it("forge-3sv2: writes to the user config path, never the read-only default", () => {
      // On a fresh install windowConfigFile is null (loadFile created the file but
      // returned null). The setter must still write to the user config path, not
      // fall back to the read-only bundled defaultWindowConfigFile.
      const userFile = createMockFile("/config/windows.json");
      userFile.get_parent = vi.fn(() => ({ get_path: () => "/config" }));
      const mockDefaultFile = createMockFile("/default/windows.json");
      mockDefaultFile.get_parent = vi.fn(() => ({ get_path: () => "/default" }));

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => null,
        configurable: true,
      });
      Object.defineProperty(configManager, "windowConfigPath", {
        get: () => userFile,
        configurable: true,
      });
      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => mockDefaultFile,
        configurable: true,
      });

      configManager.windowProps = sampleWindowConfig;

      expect(userFile.replace_contents).toHaveBeenCalled();
      expect(mockDefaultFile.replace_contents).not.toHaveBeenCalled();
    });
  });
});

describe("ConfigManager file path construction", () => {
  it("should construct correct config paths", () => {
    const mockDir = createMockDir("/usr/share/gnome-shell/extensions/forge@example.com");
    const cm = new ConfigManager({ dir: mockDir });

    expect(cm.extensionPath).toBe("/usr/share/gnome-shell/extensions/forge@example.com");
    expect(cm.confDir).toContain("forge");
  });

  it("should handle paths with special characters", () => {
    const mockDir = createMockDir("/path/with spaces/extension");
    const cm = new ConfigManager({ dir: mockDir });

    expect(cm.extensionPath).toBe("/path/with spaces/extension");
  });
});

describe("ConfigManager integration scenarios", () => {
  it("should support full config loading workflow", () => {
    const mockDir = createMockDir("/test/extension");
    const cm = new ConfigManager({ dir: mockDir });

    expect(cm.confDir).toContain("forge");
    expect(cm.defaultStylesheetFile.get_path()).toContain("stylesheet.css");
    expect(cm.defaultWindowConfigFile.get_path()).toContain("windows.json");
  });

  it("should handle missing default files gracefully", () => {
    const mockDir = createMockDir("/test/extension");
    const cm = new ConfigManager({ dir: mockDir });

    // Override query_exists to return false for default files
    vi.spyOn(File, "new_for_path").mockImplementation((path) => {
      const file = new File(path);
      file.query_exists = vi.fn(() => false);
      return file;
    });

    const stylesheet = cm.defaultStylesheetFile;
    expect(stylesheet).toBeNull();

    const windowConfig = cm.defaultWindowConfigFile;
    expect(windowConfig).toBeNull();

    vi.restoreAllMocks();
  });
});
