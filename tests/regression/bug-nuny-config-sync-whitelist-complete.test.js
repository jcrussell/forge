import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SETTINGS_KEYS,
  KEYBINDING_KEYS,
  KEYBINDING_STRING_KEYS,
} from "../../lib/shared/config-sync.js";

/**
 * Regression fence for forge-nuny / forge-eny3.
 *
 * The portable-config whitelists in config-sync.js (SETTINGS_KEYS,
 * KEYBINDING_KEYS, KEYBINDING_STRING_KEYS) must stay in lock-step with the
 * gschema. Drift means silent data loss on export/import (a live key missing
 * from the whitelist is never written) or a dead decoy key that documents a
 * knob nothing reads. This test parses the gschema straight off disk and
 * asserts the whitelists are exactly the portable surface of each schema.
 */

// Main-schema keys that are deliberately NOT portable (internal bookkeeping /
// triggers). Everything else on the main schema MUST be whitelisted.
const INTERNAL_MAIN_KEYS = [
  "css-updated",
  "css-last-update",
  "window-overrides-reload-trigger",
  "config-last-import",
  "config-last-export",
  "config-file-sync-enabled",
];

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GSCHEMA_PATH = join(REPO_ROOT, "schemas", "org.gnome.shell.extensions.forge.gschema.xml");

const MAIN_SCHEMA_ID = "org.gnome.shell.extensions.forge";
const KBD_SCHEMA_ID = "org.gnome.shell.extensions.forge.keybindings";

/**
 * Split the gschema XML into per-schema bodies keyed by schema id.
 * @returns {Map<string, string>}
 */
function readSchemaBodies() {
  const xml = readFileSync(GSCHEMA_PATH, "utf8");
  const bodies = new Map();
  // Match each <schema ...> ... </schema> block and capture its id.
  const schemaRe = /<schema\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/schema>/g;
  let m;
  while ((m = schemaRe.exec(xml)) !== null) {
    bodies.set(m[1], m[2]);
  }
  return bodies;
}

/**
 * Extract [{ name, type }] for every <key> in a schema body.
 * @param {string} body
 * @returns {Array<{name: string, type: string}>}
 */
function extractKeys(body) {
  const keyRe = /<key\b([^>]*)>/g;
  const keys = [];
  let m;
  while ((m = keyRe.exec(body)) !== null) {
    const attrs = m[1];
    const nameMatch = /\bname="([^"]+)"/.exec(attrs);
    const typeMatch = /\btype="([^"]+)"/.exec(attrs);
    if (nameMatch) {
      keys.push({ name: nameMatch[1], type: typeMatch ? typeMatch[1] : null });
    }
  }
  return keys;
}

/** Symmetric difference of two string arrays, sorted for a readable message. */
function symmetricDifference(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const onlyA = a.filter((x) => !setB.has(x)).sort();
  const onlyB = b.filter((x) => !setA.has(x)).sort();
  return { onlyA, onlyB };
}

describe("config-sync whitelist completeness (forge-nuny / forge-eny3)", () => {
  const bodies = readSchemaBodies();
  const mainKeys = extractKeys(bodies.get(MAIN_SCHEMA_ID));
  const kbdKeys = extractKeys(bodies.get(KBD_SCHEMA_ID));

  it("sanity: both schemas were parsed from disk", () => {
    expect(bodies.has(MAIN_SCHEMA_ID)).toBe(true);
    expect(bodies.has(KBD_SCHEMA_ID)).toBe(true);
    expect(mainKeys.length).toBeGreaterThan(0);
    expect(kbdKeys.length).toBeGreaterThan(0);
  });

  it("SETTINGS_KEYS exactly covers the portable main-schema keys", () => {
    const internal = new Set(INTERNAL_MAIN_KEYS);
    const expectedPortable = mainKeys
      .map((k) => k.name)
      .filter((name) => !internal.has(name))
      .sort();

    const flattened = Object.values(SETTINGS_KEYS).flat().sort();

    const { onlyA, onlyB } = symmetricDifference(flattened, expectedPortable);
    expect(
      onlyA.length === 0 && onlyB.length === 0,
      `SETTINGS_KEYS drifted from the gschema.\n` +
        `  In SETTINGS_KEYS but not portable gschema keys: ${JSON.stringify(onlyA)}\n` +
        `  Portable gschema keys missing from SETTINGS_KEYS: ${JSON.stringify(onlyB)}`
    ).toBe(true);
  });

  it("every internal main-schema key actually exists (no stale exclusions)", () => {
    const names = new Set(mainKeys.map((k) => k.name));
    for (const key of INTERNAL_MAIN_KEYS) {
      expect(names.has(key), `INTERNAL_MAIN_KEYS lists '${key}' but it is not in the gschema`).toBe(
        true
      );
    }
  });

  it("KEYBINDING_KEYS covers every 'as' keybinding, and only those", () => {
    const asKeys = kbdKeys
      .filter((k) => k.type === "as")
      .map((k) => k.name)
      .sort();
    const whitelisted = [...KEYBINDING_KEYS].sort();

    const { onlyA, onlyB } = symmetricDifference(whitelisted, asKeys);
    expect(
      onlyA.length === 0 && onlyB.length === 0,
      `KEYBINDING_KEYS drifted from the gschema 'as' keys.\n` +
        `  In KEYBINDING_KEYS but not an 'as' gschema key: ${JSON.stringify(onlyA)}\n` +
        `  'as' gschema keys missing from KEYBINDING_KEYS: ${JSON.stringify(onlyB)}`
    ).toBe(true);
  });

  it("KEYBINDING_STRING_KEYS covers every non-'as' keybinding, and only those", () => {
    const stringKeys = kbdKeys
      .filter((k) => k.type !== "as")
      .map((k) => k.name)
      .sort();
    const whitelisted = [...KEYBINDING_STRING_KEYS].sort();

    const { onlyA, onlyB } = symmetricDifference(whitelisted, stringKeys);
    expect(
      onlyA.length === 0 && onlyB.length === 0,
      `KEYBINDING_STRING_KEYS drifted from the gschema string keys.\n` +
        `  In KEYBINDING_STRING_KEYS but not a string gschema key: ${JSON.stringify(onlyA)}\n` +
        `  String gschema keys missing from KEYBINDING_STRING_KEYS: ${JSON.stringify(onlyB)}`
    ).toBe(true);
  });
});
