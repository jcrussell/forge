import { describe, it, expect } from "vitest";
import { parse, stringify } from "../../lib/css/index.js";

/**
 * Bug forge-bhjc (audit-2026-07b): Compiler.rule() did `if (!decls.length)
 * return ""`, so a rule with an empty body vanished entirely from the
 * round-trip — with ZERO parse errors, which means the forge-y3jy
 * refuse-to-write guard never fires for it. A user who comments out a rule's
 * declarations lost the whole selector the next time a prefs color change
 * rewrote ~/.config/forge/stylesheet/forge/stylesheet.css.
 *
 * A missing .window-*-border rule is also exactly the input that made
 * Gdk.RGBA.parse(undefined) throw four pages out of the prefs window
 * (forge-el84), so this loss compounds.
 *
 * Fix: emit the empty rule instead of dropping it.
 */
describe("Bug forge-bhjc: an empty rule body is deleted on round-trip", () => {
  it("preserves a rule whose declarations are all commented out", () => {
    const css = `.window-tiled-border {\n  /* border-color: rgba(1,2,3,1); */\n}\n.b {\n  color: red;\n}`;
    const ast = parse(css, { silent: true });

    // No parse error is recorded, so nothing else can catch this loss.
    expect(ast.stylesheet.parsingErrors).toHaveLength(0);

    const out = stringify(ast);
    expect(out).toContain(".window-tiled-border");
    expect(out).toContain(".b");
  });

  it("preserves a literally empty rule", () => {
    const out = stringify(parse(`.foo { }\n.bar { color: red; }`, { silent: true }));
    expect(out).toContain(".foo");
    expect(out).toContain(".bar");
  });

  it("re-parses to the same rule set (round-trip is stable)", () => {
    const css = `.foo { }\n.bar { color: red; }`;
    const first = stringify(parse(css, { silent: true }));
    const second = stringify(parse(first, { silent: true }));
    expect(second).toBe(first);
    expect(parse(first, { silent: true }).stylesheet.rules).toHaveLength(2);
  });
});
