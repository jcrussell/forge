import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../../lib/css/index.js";

/**
 * Workaround for mutter#4973 (Cogl segfault in cogl_pipeline_set_layer_combine_constant
 * while St paints a box-shadow). gnome-shell 51 crashed in the E2E suite while
 * painting the active Forge tab's box-shadow (st_theme_node_paint_sliced_shadow).
 * Until Cogl is fixed, no Forge rule may use box-shadow: the tabs drew a 1px,
 * 20%-black ring and the cheatsheet a 0 4px 16px rgba(0, 0, 0, 0.4) drop shadow.
 * Remove this guard (and restore those shadows) once mutter#4973 is fixed.
 */
describe("stylesheet.css avoids box-shadow (mutter#4973)", () => {
  const css = readFileSync(join(import.meta.dirname, "../../../stylesheet.css"), "utf8");
  const rules = parse(css).stylesheet.rules.filter((r) => r.type === "rule");

  it("has rules to check", () => {
    expect(rules.some((r) => r.selectors.includes(".window-tabbed-tab"))).toBe(true);
  });

  it.each(rules.map((r) => [r.selectors.join(", "), r]))("%s has no box-shadow", (_sel, r) => {
    const props = r.declarations.filter((d) => d.type === "declaration").map((d) => d.property);
    expect(props).not.toContain("box-shadow");
  });
});
