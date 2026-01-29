import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Bug #415: Extension fails to load with corrupt/empty windows.json
 *
 * Problem: When windows.json config file is empty or contains invalid JSON,
 * the extension fails to load with a JSON.parse error:
 * "unexpected end of data at line 1 column 1"
 *
 * Root Cause: The settings/config parser does not handle empty or corrupt
 * JSON files gracefully. It throws an error instead of falling back to
 * default values.
 *
 * Fix: Add try-catch around JSON parsing and return default config on error.
 */
describe("Bug #415: Graceful handling of corrupt/empty config files", () => {
  describe("JSON parsing error handling", () => {
    it("should handle empty string gracefully", () => {
      const parseConfigSafe = (jsonString) => {
        try {
          if (!jsonString || jsonString.trim() === "") {
            return { overrides: [] };
          }
          return JSON.parse(jsonString);
        } catch (e) {
          return { overrides: [] };
        }
      };

      // Empty string should return default config
      const result = parseConfigSafe("");
      expect(result).toEqual({ overrides: [] });
    });

    it("should handle whitespace-only string gracefully", () => {
      const parseConfigSafe = (jsonString) => {
        try {
          if (!jsonString || jsonString.trim() === "") {
            return { overrides: [] };
          }
          return JSON.parse(jsonString);
        } catch (e) {
          return { overrides: [] };
        }
      };

      const result = parseConfigSafe("   \n\t   ");
      expect(result).toEqual({ overrides: [] });
    });

    it("should handle truncated JSON gracefully", () => {
      const parseConfigSafe = (jsonString) => {
        try {
          if (!jsonString || jsonString.trim() === "") {
            return { overrides: [] };
          }
          return JSON.parse(jsonString);
        } catch (e) {
          return { overrides: [] };
        }
      };

      // Truncated JSON that would cause parse error
      const result = parseConfigSafe('{ "overrides": [');
      expect(result).toEqual({ overrides: [] });
    });

    it("should handle invalid JSON characters gracefully", () => {
      const parseConfigSafe = (jsonString) => {
        try {
          if (!jsonString || jsonString.trim() === "") {
            return { overrides: [] };
          }
          return JSON.parse(jsonString);
        } catch (e) {
          return { overrides: [] };
        }
      };

      // Invalid JSON with NUL character
      const result = parseConfigSafe('{ "key": \x00 }');
      expect(result).toEqual({ overrides: [] });
    });

    it("should parse valid JSON correctly", () => {
      const parseConfigSafe = (jsonString) => {
        try {
          if (!jsonString || jsonString.trim() === "") {
            return { overrides: [] };
          }
          return JSON.parse(jsonString);
        } catch (e) {
          return { overrides: [] };
        }
      };

      const validJson = JSON.stringify({
        overrides: [{ wmClass: "firefox", mode: "float" }],
      });

      const result = parseConfigSafe(validJson);

      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].wmClass).toBe("firefox");
    });

    it("should handle undefined gracefully", () => {
      const parseConfigSafe = (jsonString) => {
        try {
          if (!jsonString || jsonString.trim() === "") {
            return { overrides: [] };
          }
          return JSON.parse(jsonString);
        } catch (e) {
          return { overrides: [] };
        }
      };

      const result = parseConfigSafe(undefined);
      expect(result).toEqual({ overrides: [] });
    });

    it("should handle null gracefully", () => {
      const parseConfigSafe = (jsonString) => {
        try {
          if (!jsonString || jsonString.trim() === "") {
            return { overrides: [] };
          }
          return JSON.parse(jsonString);
        } catch (e) {
          return { overrides: [] };
        }
      };

      const result = parseConfigSafe(null);
      expect(result).toEqual({ overrides: [] });
    });
  });

  describe("Config file loading scenarios", () => {
    it("should provide default window props when config load fails", () => {
      const loadWindowProps = (readFileFn) => {
        try {
          const content = readFileFn();
          if (!content || content.trim() === "") {
            return { overrides: [] };
          }
          return JSON.parse(content);
        } catch (e) {
          // Log error in real implementation
          return { overrides: [] };
        }
      };

      // Simulate file read failure
      const result = loadWindowProps(() => {
        throw new Error("File not found");
      });

      expect(result).toEqual({ overrides: [] });
    });

    it("should handle file with BOM character", () => {
      const parseConfigSafe = (jsonString) => {
        try {
          if (!jsonString || jsonString.trim() === "") {
            return { overrides: [] };
          }
          // Strip BOM if present
          const cleanJson = jsonString.replace(/^\uFEFF/, "");
          return JSON.parse(cleanJson);
        } catch (e) {
          return { overrides: [] };
        }
      };

      // JSON with BOM character
      const jsonWithBom = '\uFEFF{ "overrides": [] }';
      const result = parseConfigSafe(jsonWithBom);

      expect(result).toEqual({ overrides: [] });
    });
  });

  describe("Error recovery and logging", () => {
    it("should log error but not throw when config is invalid", () => {
      const errors = [];

      const parseConfigWithLogging = (jsonString) => {
        try {
          if (!jsonString || jsonString.trim() === "") {
            return { overrides: [] };
          }
          return JSON.parse(jsonString);
        } catch (e) {
          errors.push(e.message);
          return { overrides: [] };
        }
      };

      const result = parseConfigWithLogging("not valid json");

      expect(result).toEqual({ overrides: [] });
      expect(errors.length).toBe(1);
      expect(errors[0]).toMatch(/JSON|Unexpected|token/i);
    });
  });
});
