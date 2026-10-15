import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../../lib/css/index.js";

/**
 * Workaround for mutter#4973 (Cogl segfault in cogl_pipeline_set_layer_combine_constant
 * while St paints a box-shadow). gnome-shell 51 crashed in the E2E suite while
 * painting the active Forge tab's box-shadow (st_theme_node_paint_sliced_shadow).
 * Until Cogl is fixed, the tab rules must not use box-shadow; the ring they drew
 * was a 1px, 20%-black outline. Remove this guard once mutter#4973 is fixed.
 */
describe("stylesheet.css tab rules avoid box-shadow (mutter#4973)", () => {
  const css = readFileSync(join(import.meta.dirname, "../../../stylesheet.css"), "utf8");
  const tabRules = parse(css).stylesheet.rules.filter(
    (r) => r.type === "rule" && r.selectors.some((s) => s.includes(".window-tabbed-tab"))
  );

  it("has tab rules to check", () => {
    expect(tabRules.length).toBeGreaterThan(0);
  });

  it.each(tabRules.map((r) => [r.selectors.join(", "), r]))("%s has no box-shadow", (_sel, r) => {
    const props = r.declarations.filter((d) => d.type === "declaration").map((d) => d.property);
    expect(props).not.toContain("box-shadow");
  });
});
