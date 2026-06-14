// Pure, GTK-free helpers for manipulating window override lists.
// Kept separate from floating.js so the logic is unit-testable without GTK/Adw.

/**
 * Structural identity of a window override. We match on the full identifying
 * tuple rather than object reference because ConfigManager.windowProps re-parses
 * windows.json on every read — the override captured when a row was built is a
 * different instance than the one read back at removal time, so reference
 * equality would match nothing. Matching wmClass alone (the old bug, forge-fov0)
 * over-matched and deleted same-class siblings and invisible tile rules.
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean} true when a and b are the same override rule
 */
export function sameOverride(a, b) {
  return (
    (a.wmClass ?? null) === (b.wmClass ?? null) &&
    (a.wmTitle ?? null) === (b.wmTitle ?? null) &&
    (a.mode ?? null) === (b.mode ?? null) &&
    (a.wmId ?? null) === (b.wmId ?? null)
  );
}

/**
 * Remove a single override from the list by structural identity.
 *
 * Siblings that share the same wmClass — e.g. two float rules with different
 * wmTitle, or a tile rule of the same class — are preserved.
 *
 * @param {Array<object>} overrides - the current overrides
 * @param {object} target - the override to remove (matched structurally)
 * @returns {Array<object>} a new array without the matching override(s)
 */
export function removeOverride(overrides, target) {
  return overrides.filter((o) => !sameOverride(o, target));
}

/**
 * Filter to float-mode overrides and sort them for display.
 *
 * A title-only rule (no wmClass, forge-n29i) has an undefined wmClass, so the
 * naive `a.wmClass.localeCompare(...)` throws and crashes the prefs Windows
 * page on open. Sort by wmClass (the row subtitle), falling back to wmTitle
 * then empty so classless rules order safely — this preserves the historical
 * class-alphabetical order for class-full rules (whose key is just wmClass).
 *
 * @param {Array<object>} overrides - all overrides (mixed modes)
 * @returns {Array<object>} float overrides sorted by display key
 */
export function sortFloatOverrides(overrides) {
  return overrides
    .filter((o) => o.mode === "float")
    .sort((a, b) => {
      const aKey = a.wmClass ?? a.wmTitle ?? "";
      const bKey = b.wmClass ?? b.wmTitle ?? "";
      return aKey.localeCompare(bKey);
    });
}

/**
 * Subtitle text for a float-override row. The subtitle shows the matched
 * wmClass; a classless title-only rule (forge-4w7e) has none, which rendered as
 * a blank subtitle. Fall back to a caller-supplied (translated) label so the
 * row reads as intentional. The label is passed in to keep this module free of
 * GTK/gettext imports and unit-testable.
 *
 * @param {object} override
 * @param {string} titleOnlyLabel - shown when the override has no wmClass
 * @returns {string}
 */
export function floatRowSubtitle(override, titleOnlyLabel) {
  return override.wmClass ?? titleOnlyLabel;
}
