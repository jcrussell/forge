import { describe, it, expect, beforeEach, vi } from "vitest";
import { parse } from "../../lib/css/index.js";

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

  describe("Defensive handling of rule types", () => {
    /**
     * This tests the pattern used in the fix - checking for declarations
     * before trying to filter them.
     */
    it("should safely handle rules without declarations when filtering", () => {
      const css = `
        /* A comment */
        @charset "UTF-8";
        .tiled {
          color: #ff0000;
          border-width: 2px;
        }
        .floated {
          opacity: 0.5;
        }
      `;

      const ast = parse(css);
      const rules = ast.stylesheet.rules;

      // Simulate the getCssProperty pattern with defensive check
      const getCssPropertySafe = (selector, propertyName) => {
        const matchRules = rules.filter(
          (r) => r.selectors && r.selectors.filter((s) => s === selector).length > 0
        );
        const cssRule = matchRules.length > 0 ? matchRules[0] : {};

        // Bug #448 fix: Check both cssRule and declarations exist
        if (cssRule && cssRule.declarations) {
          const matchDeclarations = cssRule.declarations.filter((d) => d.property === propertyName);
          return matchDeclarations.length > 0 ? matchDeclarations[0] : {};
        }
        return {};
      };

      // Should work for valid rules
      const colorProp = getCssPropertySafe(".tiled", "color");
      expect(colorProp.value).toBe("#ff0000");

      // Should return empty object for non-existent selectors
      const nonExistent = getCssPropertySafe(".nonexistent", "color");
      expect(nonExistent).toEqual({});

      // Should not throw when iterating over rules including comments
      expect(() => {
        rules.forEach((rule) => {
          // This is what would cause the error without the fix
          if (rule.declarations) {
            rule.declarations.forEach((d) => d.property);
          }
        });
      }).not.toThrow();
    });

    it("should not throw when CSS rule has no selectors (comments, @-rules)", () => {
      const css = `
        /* Comment without selectors */
        @font-face {
          font-family: "MyFont";
          src: url("myfont.woff2");
        }
        .tiled {
          color: blue;
        }
      `;

      const ast = parse(css);
      const rules = ast.stylesheet.rules;

      // Simulate the getCssRule pattern
      const getCssRuleSafe = (selector) => {
        const matchRules = rules.filter(
          (r) => r.selectors && r.selectors.filter((s) => s === selector).length > 0
        );
        return matchRules.length > 0 ? matchRules[0] : {};
      };

      // Rules without selectors (comments, @-rules) should not match
      const result = getCssRuleSafe(".tiled");
      expect(result.declarations).toBeDefined();

      // Non-matching selector returns empty object
      const noMatch = getCssRuleSafe(".nonexistent");
      expect(noMatch).toEqual({});
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
