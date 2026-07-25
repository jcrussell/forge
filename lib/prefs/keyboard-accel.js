// Pure, GTK-free helper for validating keyboard accelerator input.
// Kept separate from keyboard.js so the parse/validate logic is unit-testable
// without importing gi://Gtk (which breaks under vitest). The Gtk accelerator
// functions are injected so tiny fakes can drive the logic in tests.

/**
 * Parse and validate a comma-separated accelerator string.
 *
 * An empty string is treated as a deliberate clear (valid, strv []). A non-empty
 * string is valid only when EVERY comma-separated token parses to a valid
 * accelerator — a mixed valid/invalid input is rejected as a whole so no partial
 * save occurs (forge-f5sl).
 *
 * @param {string} value - raw entry text, e.g. "<Super>a,<Super>b"
 * @param {object} gtk - injected Gtk-like accelerator functions
 * @param {(x: string) => [boolean, number, number]} gtk.parse - accelerator_parse
 * @param {(key: number, mods: number) => boolean} gtk.valid - accelerator_valid
 * @param {(key: number, mods: number) => (string | null)} gtk.name - accelerator_name
 * @returns {{ valid: boolean, strv: string[] | null }}
 *   valid=true with strv set on success/clear; valid=false with strv=null on
 *   invalid input.
 */
export function accelStrvFromInput(value, { parse, valid, name }) {
  if (!value) {
    // Clearing a binding is legitimate.
    return { valid: true, strv: [] };
  }
  const mappings = value.split(",").map((x) => {
    const [, key, mods] = parse(x);
    return valid(key, mods) && name(key, mods);
  });
  if (mappings.every((x) => !!x)) {
    // Every token is a truthy accelerator string here; .every() doesn't narrow
    // the array element type, so assert the post-guard shape.
    return { valid: true, strv: /** @type {string[]} */ (mappings) };
  }
  return { valid: false, strv: null };
}

/**
 * Find other keybindings that already use any accelerator in `strv` (forge-cos).
 *
 * Conflicts are surfaced, not rejected — a user may intentionally reuse a chord
 * across modes and resolve it themselves. The lookup is pure and GTK-free so it
 * is unit-testable with injected data.
 *
 * @param {string[]} strv - canonical accelerators about to be assigned to selfBind
 * @param {object} opts
 * @param {string} opts.selfBind - the key being edited (excluded from results)
 * @param {string[]} opts.keys - all keybinding key names to scan
 * @param {(key: string) => string[]} opts.getStrv - reads a key's current strv
 * @returns {{ accel: string, key: string }[]} one entry per offending accel/key pair
 */
export function findAccelConflicts(strv, { selfBind, keys, getStrv }) {
  const conflicts = [];
  for (const accel of strv) {
    for (const key of keys) {
      if (key === selfBind) continue;
      if (getStrv(key).includes(accel)) {
        conflicts.push({ accel, key });
      }
    }
  }
  return conflicts;
}
