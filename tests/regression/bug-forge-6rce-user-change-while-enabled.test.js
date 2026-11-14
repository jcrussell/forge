import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import { Settings as MockSettings } from "../mocks/gnome/Gio.js";
import { SETTINGS_OVERRIDES, SNAPSHOT_KEY } from "../../lib/shared/gnome-overrides.js";

vi.mock("../../lib/extension/indicator.js", () => ({
  FeatureIndicator: class FeatureIndicator {
    quickSettingsItems = [];
    destroy() {}
  },
  FeatureMenuToggle: vi.fn(function FeatureMenuToggle() {
    this.destroy = vi.fn();
  }),
}));

// Same seam as forge-7t96: importing extension.js must not build a real ConfigSync.
vi.mock("../../lib/shared/config-sync.js", () => ({
  ConfigSync: class ConfigSync {
    init() {
      throw new Error("stop after overrides");
    }
    destroy() {}
  },
}));

import ForgeExtension from "../../extension.js";

/**
 * forge-6rce: disable() and the runtime restore wrote the enable-time original
 * back over a GNOME key the user changed while Forge was enabled (e.g. rebinding
 * minimize in GNOME Settings). A live value other than Forge's override value is
 * the user's and is kept.
 */
const getter = (desc) => (desc.type === "boolean" ? "get_boolean" : "get_strv");
const setter = (desc) => (desc.type === "boolean" ? "set_boolean" : "set_strv");
const originalValue = (desc) => (desc.type === "boolean" ? true : [`<Super>original-${desc.key}`]);
const changedValue = (desc) => [`<Super>changed-${desc.key}`];

describe("forge-6rce: a GNOME key changed while Forge is enabled keeps the user's value", () => {
  let dconf; // schemaId -> settings, shared like dconf
  let forgeSettings;
  let realSchemaSource;
  let RealSettings;

  beforeEach(() => {
    dconf = new Map();
    RealSettings = Gio.Settings;
    realSchemaSource = Gio.SettingsSchemaSource;
    Gio.SettingsSchemaSource = {
      get_default: () => ({ lookup: () => ({ has_key: () => true }) }),
    };
    for (const desc of SETTINGS_OVERRIDES) {
      if (!dconf.has(desc.schemaId)) dconf.set(desc.schemaId, new MockSettings(desc.schemaId));
      dconf.get(desc.schemaId)[setter(desc)](desc.key, originalValue(desc));
    }
    Gio.Settings = function SharedSettings(props) {
      return dconf.get(typeof props === "string" ? props : props?.schemaId);
    };
    forgeSettings = new MockSettings("org.gnome.shell.extensions.forge");
    forgeSettings.set_boolean("disable-edge-tiling", true);
    forgeSettings.set_boolean("tiling-mode-enabled", true);
  });

  afterEach(() => {
    Gio.Settings = RealSettings;
    Gio.SettingsSchemaSource = realSchemaSource;
  });

  /** An extension with every override applied the way enable() applies them. */
  function enabledExtension() {
    const ext = new ForgeExtension();
    ext.settings = forgeSettings;
    ext._savedSettings = [];
    ext._gnomeSettings = new Map();
    for (const desc of SETTINGS_OVERRIDES) ext._applyOverride(desc);
    return ext;
  }

  const live = (desc) => dconf.get(desc.schemaId)[getter(desc)](desc.key);

  it("disable() keeps keybindings the user rebound and restores the rest", () => {
    const untouched = SETTINGS_OVERRIDES.find((d) => d.key === "maximize");
    const changed = SETTINGS_OVERRIDES.filter((d) => d.type === "strv" && d !== untouched);
    const ext = enabledExtension();
    for (const desc of changed) dconf.get(desc.schemaId).set_strv(desc.key, changedValue(desc));

    ext.disable();

    for (const desc of changed) {
      expect(live(desc), `${desc.schemaId} '${desc.key}' clobbered`).toEqual(changedValue(desc));
    }
    expect(live(untouched)).toEqual(originalValue(untouched));
    expect(forgeSettings.get_string(SNAPSHOT_KEY)).toBe("");
  });

  it("turning tiling off keeps edge-tiling the user flipped", () => {
    const desc = SETTINGS_OVERRIDES.find((d) => d.key === "edge-tiling");
    const gsettings = dconf.get(desc.schemaId);
    gsettings.set_boolean("edge-tiling", false); // original: off
    const ext = enabledExtension();
    gsettings.set_boolean("edge-tiling", true); // user turns it on in GNOME

    forgeSettings.set_boolean("tiling-mode-enabled", false);
    ext._reconcileOverridesFor("tiling-mode-enabled");

    expect(gsettings.get_boolean("edge-tiling")).toBe(true);
    expect(ext._isOverrideSaved(desc)).toBe(false);
    expect(forgeSettings.get_string(SNAPSHOT_KEY)).not.toContain("edge-tiling");
  });
});
