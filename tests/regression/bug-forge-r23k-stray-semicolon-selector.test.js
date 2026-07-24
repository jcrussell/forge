import { describe, it, expect } from "vitest";
import { parse, stringify } from "../../lib/css/index.js";

/**
 * Bug forge-r23k (audit-2026-07b): a `;` after a rule's closing brace is
 * meaningless CSS, but selector() matches /^([^{]+)/ and swallowed it into the
 * NEXT rule's selector (`;\n.b`), so that rule stopped matching in St. Like
 * forge-bhjc this parses with ZERO errors, so the forge-y3jy refuse-to-write
 * guard never fires and the corruption is written back to the user's stylesheet.
 *
 * Fix: consume stray semicolons between rules, interleaved with comments.
 */
describe("Bug forge-r23k: a stray ';' between rules corrupts the next selector", () => {
  it("does not glom a trailing ';' into the following selector", () => {
    const ast = parse(`.a { color: red; };\n.b { color: blue; }`, { silent: true });

    expect(ast.stylesheet.rules).toHaveLength(2);
    expect(ast.stylesheet.rules[1].selectors).toEqual([".b"]);
    expect(stringify(ast)).not.toContain(";\n.b");
  });

  it("handles a ';' separated from the next rule by a comment", () => {
    const ast = parse(`.a { color: red; }/* note */;.b { color: blue; }`, { silent: true });
    const rules = ast.stylesheet.rules.filter((r) => r.type === "rule");

    expect(rules).toHaveLength(2);
    expect(rules[1].selectors).toEqual([".b"]);
  });

  it("handles a ';' before a comment", () => {
    const ast = parse(`.a { color: red; };/* note */\n.b { color: blue; }`, { silent: true });
    const rules = ast.stylesheet.rules.filter((r) => r.type === "rule");

    expect(rules).toHaveLength(2);
    expect(rules[1].selectors).toEqual([".b"]);
  });

  it("handles a leading ';' at the top of the stylesheet", () => {
    const ast = parse(`;\n.a { color: red; }`, { silent: true });

    expect(ast.stylesheet.rules).toHaveLength(1);
    expect(ast.stylesheet.rules[0].selectors).toEqual([".a"]);
  });
});
