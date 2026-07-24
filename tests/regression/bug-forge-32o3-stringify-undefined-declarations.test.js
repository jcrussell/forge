import { describe, it, expect } from "vitest";
import { parse, stringify } from "../../lib/css/index.js";

/**
 * Bug forge-32o3 (audit-2026-07b): declarations() returns undefined in silent
 * mode (its error() path), but rule() still built a node with
 * `declarations: undefined`. Compiler.rule() then read `node.declarations.length`
 * and threw a TypeError.
 *
 * theme.js parses the USER stylesheet with { silent: true } precisely so a bad
 * file can't abort enable(), so this AST is the normal outcome of a hand-edit
 * typo. The throw escaped setCssProperty into the prefs GTK color-set handler:
 * nothing written, nothing logged, updateCssColors() aborted before the
 * remaining selectors — and the AST was left mutated, so re-picking the same
 * color hit the forge-w3ss idempotency short-circuit and returned true without
 * ever attempting a write.
 *
 * Fix: `node.declarations || []` in Compiler.rule() and Compiler.keyframe().
 */
describe("Bug forge-32o3: stringify throws on a silently-parsed malformed rule", () => {
  const cases = [
    ["a rule missing its closing brace", `.a { color: red; }\n.b { color: blue;`],
    ["an unknown block at-rule", `@layer base { .a { color: red; } }`],
    ["an at-rule the case-sensitive regexes miss", `@MEDIA screen { .a { color: red; } }`],
  ];

  for (const [label, css] of cases) {
    it(`does not throw for ${label}`, () => {
      const ast = parse(css, { silent: true });
      expect(() => stringify(ast)).not.toThrow();
    });
  }

  it("does not throw for a keyframe missing its closing brace", () => {
    const ast = parse(`@keyframes spin { from { opacity: 0;`, { silent: true });
    expect(() => stringify(ast)).not.toThrow();
  });

  it("still round-trips a well-formed stylesheet unchanged", () => {
    const css = `.a {\n  color: red;\n}`;
    expect(stringify(parse(css, { silent: true }))).toBe(css);
  });
});
