// GTK-free descriptors + gating policy for the GNOME settings Forge overrides
// while enabled. Kept out of extension.js so the policy is unit-testable without
// importing the Shell Extension base class (which breaks under vitest).

/**
 * Descriptors for GNOME settings Forge overrides while enabled. Each entry saves
 * the original value during enable() and restores it during disable().
 *
 * An optional `gatedBy` names a Forge boolean setting (or an array of settings,
 * all of which must be true) that gates whether the override applies, letting
 * users opt out of a specific override (e.g. keep GNOME's native edge/half-
 * tiling). When `gatedBy` is absent the override always applies. A gated-off
 * override is never applied and never saved, so there is nothing to restore for
 * it on disable().
 *
 * forge-abk: edge-tiling is gated by BOTH `disable-edge-tiling` AND
 * `tiling-mode-enabled`, so toggling Forge tiling off at runtime restores
 * GNOME's native edge-tiling (and re-applies the override when toggled back on).
 * See reconcileAction() + the change-signal wiring in extension.js.
 */
export const SETTINGS_OVERRIDES = [
  {
    schemaId: "org.gnome.mutter",
    key: "edge-tiling",
    type: "boolean",
    newValue: false,
    gatedBy: ["disable-edge-tiling", "tiling-mode-enabled"],
  },
  { schemaId: "org.gnome.mutter", key: "auto-maximize", type: "boolean", newValue: false },
  {
    schemaId: "org.gnome.mutter.keybindings",
    key: "toggle-tiled-left",
    type: "strv",
    newValue: [],
  },
  {
    schemaId: "org.gnome.mutter.keybindings",
    key: "toggle-tiled-right",
    type: "strv",
    newValue: [],
  },
  { schemaId: "org.gnome.desktop.wm.keybindings", key: "maximize", type: "strv", newValue: [] },
  { schemaId: "org.gnome.desktop.wm.keybindings", key: "unmaximize", type: "strv", newValue: [] },
  { schemaId: "org.gnome.desktop.wm.keybindings", key: "minimize", type: "strv", newValue: [] },
  {
    schemaId: "org.gnome.shell.keybindings",
    key: "toggle-message-tray",
    type: "strv",
    newValue: [],
  },
  // forge-m37 (#249): free GNOME's native Super+L lock so it doesn't collide with
  // Forge's vim window-focus-right (<Super>l). Forge provides locking via
  // prefs-lock-screen (<Super>q). Restored on disable() like the others. The
  // enable() loop now skips any override whose schema/key is absent (forge-rj4x),
  // so this no longer depends on being ordered last for crash-safety.
  {
    schemaId: "org.gnome.settings-daemon.plugins.media-keys",
    key: "screensaver",
    type: "strv",
    newValue: [],
  },
];

/**
 * Whether a GNOME override should be applied, given Forge's settings (forge-9fo).
 *
 * @param {object} desc - a SETTINGS_OVERRIDES entry
 * @param {{ get_boolean: (key: string) => boolean }} forgeSettings
 * @returns {boolean} true when the override should be applied
 */
export function shouldApplyOverride(desc, forgeSettings) {
  if (!desc.gatedBy) return true;
  const keys = Array.isArray(desc.gatedBy) ? desc.gatedBy : [desc.gatedBy];
  return keys.every((key) => forgeSettings.get_boolean(key));
}

/**
 * Override descriptors whose gating includes `settingKey` — i.e. those a runtime
 * change to that Forge boolean must reconcile (forge-abk).
 *
 * @param {string} settingKey - a Forge boolean setting name
 * @returns {object[]} the matching SETTINGS_OVERRIDES entries
 */
export function overridesGatedBy(settingKey) {
  return SETTINGS_OVERRIDES.filter((desc) => {
    if (!desc.gatedBy) return false;
    const keys = Array.isArray(desc.gatedBy) ? desc.gatedBy : [desc.gatedBy];
    return keys.includes(settingKey);
  });
}

/**
 * Decide what to do with one override when a gating setting changes at runtime
 * (forge-abk). Pure so it can be unit-tested without live Gio.Settings; the
 * caller performs the actual apply/restore I/O.
 *
 * @param {object} desc - a SETTINGS_OVERRIDES entry
 * @param {{ get_boolean: (key: string) => boolean }} forgeSettings
 * @param {boolean} isCurrentlySaved - whether the override is currently applied
 *   (i.e. its original value has been saved for restore)
 * @returns {"apply" | "restore" | "noop"}
 */
export function reconcileAction(desc, forgeSettings, isCurrentlySaved) {
  const shouldApply = shouldApplyOverride(desc, forgeSettings);
  if (shouldApply && !isCurrentlySaved) return "apply";
  if (!shouldApply && isCurrentlySaved) return "restore";
  return "noop";
}
