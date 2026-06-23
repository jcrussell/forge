// GTK-free descriptors + gating policy for the GNOME settings Forge overrides
// while enabled. Kept out of extension.js so the policy is unit-testable without
// importing the Shell Extension base class (which breaks under vitest).

/**
 * Descriptors for GNOME settings Forge overrides while enabled. Each entry saves
 * the original value during enable() and restores it during disable().
 *
 * An optional `gatedBy` names a Forge boolean setting that must be true for the
 * override to apply, letting users opt out of a specific override (e.g. keep
 * GNOME's native edge/half-tiling). When `gatedBy` is absent the override always
 * applies. A gated-off override is never applied and never saved, so there is
 * nothing to restore for it on disable().
 */
export const SETTINGS_OVERRIDES = [
  {
    schemaId: "org.gnome.mutter",
    key: "edge-tiling",
    type: "boolean",
    newValue: false,
    gatedBy: "disable-edge-tiling",
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
  return forgeSettings.get_boolean(desc.gatedBy);
}
