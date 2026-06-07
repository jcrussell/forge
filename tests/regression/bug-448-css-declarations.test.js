import { describe, it, expect, beforeEach, vi } from "vitest";
import { parse } from "../../lib/css/index.js";
import { ThemeManagerBase } from "../../lib/shared/theme.js";
import { File, Settings } from "../mocks/gnome/Gio.js";

/**
 * Bug #448: TypeError: cssRule.declarations is undefined
 *
 * Problem: When parsing CSS that contains rules without declarations (like
 * @-rules, comments, or malformed CSS), the theme.js getCssProperty() function
 * threw a TypeError because it tried to access .declarations on a rule that
 * didn't have that property.
 *
 * Root Cause: The CSS parser can return different rule types (rules, comments,
 * @-rules) that don't all have the same structure. Regular rules have
 * declarations, but other types don't.
 *
 * Fix: Added defensive check `if (cssRule && cssRule.declarations)` in
 * getCssProperty() at lib/shared/theme.js:122
 */

// Minimal palette the ThemeManagerBase constructor reads via getDefaultPalette().
const PALETTE_CSS = `
.tiled { color: #ffffff; border-width: 1px; opacity: 1; }
.split { color: #ffffff; border-width: 1px; opacity: 1; }
.floated { color: #ffffff; border-width: 1px; opacity: 1; }
.stacked { color: #ffffff; border-width: 1px; opacity: 1; }
.tabbed { color: #ffffff; border-width: 1px; opacity: 1; }
`;

/**
 * Build a real ThemeManagerBase whose stylesheet contains the given CSS, so
 * the genuine getCssRule()/getCssProperty() methods (with the #448 fix) can be
 * exercised directly.
 */
function createThemeManager(css) {
  const mockFile = new File("/mock/stylesheet.css");
  mockFile.load_contents = vi.fn(() => [true, new TextEncoder().encode(PALETTE_CSS + css), null]);
  mockFile.replace_contents = vi.fn(() => [true, null]);
  mockFile.get_parent = vi.fn(() => ({ get_path: () => "/mock" }));

  const configMgr = {
    stylesheetFile: mockFile,
    defaultStylesheetFile: mockFile,
    stylesheetFileName: "/mock/stylesheet.css",
  };

  return new ThemeManagerBase({ configMgr, settings: new Settings() });
}

describe("Bug #448: CSS parsing with rules without declarations", () => {
  describe("CSS parser returns different rule types", () => {
    it("should parse regular CSS rules with declarations", () => {
      const css = `
        .tiled {
          color: #ff0000;
          border-width: 2px;
        }
      `;

      const ast = parse(css);

      expect(ast.stylesheet.rules.length).toBeGreaterThan(0);
      const rule = ast.stylesheet.rules[0];
      expect(rule.type).toBe("rule");
      expect(rule.declarations).toBeDefined();
      expect(rule.declarations.length).toBeGreaterThan(0);
    });

    it("should parse CSS with comments (which have no declarations)", () => {
      const css = `
        /* This is a comment */
        .tiled {
          color: #ff0000;
        }
      `;

      const ast = parse(css);

      // Comments are included in the AST but have no declarations
      const comment = ast.stylesheet.rules.find((r) => r.type === "comment");
      if (comment) {
        expect(comment.declarations).toBeUndefined();
      }
    });

    it("should parse CSS with @-rules (which may not have declarations)", () => {
      const css = `
        @charset "UTF-8";
        .tiled {
          color: #ff0000;
        }
      `;

      const ast = parse(css);

      // @charset is a different rule type
      const charsetRule = ast.stylesheet.rules.find((r) => r.type === "charset");
      if (charsetRule) {
        expect(charsetRule.declarations).toBeUndefined();
      }
    });

    it("should parse CSS with @import rules", () => {
      const css = `
        @import url("other.css");
        .tiled {
          color: #ff0000;
        }
      `;

      const ast = parse(css);

      const importRule = ast.stylesheet.rules.find((r) => r.type === "import");
      if (importRule) {
        expect(importRule.declarations).toBeUndefined();
      }
    });
  });

  describe("Defensive handling of rule types (real getCssProperty/getCssRule)", () => {
    /**
     * These exercise the genuine ThemeManagerBase.getCssProperty()/getCssRule()
     * which contain the #448 fix.
     */
    it("getCssProperty resolves a real declaration without throwing on @-rules/comments", () => {
      const css = `
        /* A comment */
        @charset "UTF-8";
        .custom-tile {
          color: #ff0000;
          border-width: 2px;
        }
        .custom-float {
          opacity: 0.5;
        }
      `;

      const theme = createThemeManager(css);

      // Should work for valid rules
      const colorProp = theme.getCssProperty(".custom-tile", "color");
      expect(colorProp.value).toBe("#ff0000");

      // Should return empty object for non-existent selectors (no throw)
      let nonExistent;
      expect(() => {
        nonExistent = theme.getCssProperty(".nonexistent", "color");
      }).not.toThrow();
      expect(nonExistent).toEqual({});
    });

    it("getCssRule does not throw when CSS has rules without selectors (comments, @-rules)", () => {
      const css = `
        /* Comment without selectors */
        @font-face {
          font-family: "MyFont";
          src: url("myfont.woff2");
        }
        .custom-tile {
          color: blue;
        }
      `;

      const theme = createThemeManager(css);

      // Real rule still matched and has declarations, despite sibling @-rules
      let result;
      expect(() => {
        result = theme.getCssRule(".custom-tile");
      }).not.toThrow();
      expect(result.declarations).toBeDefined();

      // Non-matching selector returns empty object
      const noMatch = theme.getCssRule(".nonexistent");
      expect(noMatch).toEqual({});

      // The property lookup over the same stylesheet must not throw either
      expect(() => theme.getCssProperty(".custom-tile", "color")).not.toThrow();
    });
  });

  describe("Edge cases in CSS parsing", () => {
    it("should handle empty CSS", () => {
      const css = "";
      const ast = parse(css);

      expect(ast.stylesheet.rules).toEqual([]);
    });

    it("should handle CSS with only comments", () => {
      const css = `
        /* Just a comment */
        /* Another comment */
      `;

      const ast = parse(css);

      // All rules should be comments
      ast.stylesheet.rules.forEach((rule) => {
        if (rule.type) {
          expect(rule.declarations).toBeUndefined();
        }
      });
    });

    it("should handle CSS with empty rule block", () => {
      const css = `
        .empty {
        }
        .normal {
          color: red;
        }
      `;

      const ast = parse(css);

      const emptyRule = ast.stylesheet.rules.find(
        (r) => r.selectors && r.selectors.includes(".empty")
      );

      if (emptyRule) {
        // Empty rule should have declarations array, just empty
        expect(emptyRule.declarations).toBeDefined();
        expect(emptyRule.declarations.length).toBe(0);
      }
    });
  });
});
