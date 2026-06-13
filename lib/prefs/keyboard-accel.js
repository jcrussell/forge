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
 * @param {(key: number, mods: number) => string} gtk.name - accelerator_name
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
    return { valid: true, strv: mappings };
  }
  return { valid: false, strv: null };
}
