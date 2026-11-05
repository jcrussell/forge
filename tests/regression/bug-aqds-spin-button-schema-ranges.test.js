import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Regression fence for forge-aqds.
 *
 * A SpinButtonRow bound to a GSettings key (settings.bind, DEFAULT flags) clamps
 * an out-of-range stored value to its Gtk.Adjustment and writes the clamped value
 * back to GSettings. A matching <range> on the key keeps out-of-range values from
 * being stored at all. This test pairs every bound SpinButtonRow in lib/prefs with
 * its gschema key and asserts the two ranges are identical.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREFS_DIR = join(REPO_ROOT, "lib", "prefs");
const GSCHEMA_PATH = join(REPO_ROOT, "schemas", "org.gnome.shell.extensions.forge.gschema.xml");

/** @returns {Array<{file: string, key: string, min: number, max: number}>} */
function boundSpinButtonRows() {
  const rows = [];
  for (const file of readdirSync(PREFS_DIR).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(PREFS_DIR, file), "utf8");
    const blockRe = /new SpinButtonRow\(\{([\s\S]*?)\}\)/g;
    let m;
    while ((m = blockRe.exec(src)) !== null) {
      const bind = /\bbind:\s*"([^"]+)"/.exec(m[1]);
      if (!bind) continue;
      const range = /\brange:\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,/.exec(m[1]);
      rows.push({ file, key: bind[1], min: Number(range[1]), max: Number(range[2]) });
    }
  }
  return rows;
}

/** @returns {Map<string, {min: number, max: number}>} */
function schemaRanges() {
  const xml = readFileSync(GSCHEMA_PATH, "utf8");
  const ranges = new Map();
  const keyRe = /<key\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/key>/g;
  let m;
  while ((m = keyRe.exec(xml)) !== null) {
    const range = /<range\s+min="(-?\d+)"\s+max="(-?\d+)"\s*\/>/.exec(m[2]);
    if (range) ranges.set(m[1], { min: Number(range[1]), max: Number(range[2]) });
  }
  return ranges;
}

describe("forge-aqds: bound SpinButtonRow ranges match gschema <range>", () => {
  const rows = boundSpinButtonRows();
  const ranges = schemaRanges();

  it("finds the bound spin-button rows", () => {
    expect(rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(["window-gap-size", "focus-border-radius", "stacked-tab-bar-height"])
    );
  });

  it.each(rows.map((r) => [r.key, r]))(
    "%s has a schema range equal to its widget range",
    (_, row) => {
      expect(ranges.get(row.key)).toEqual({ min: row.min, max: row.max });
    }
  );
});
