import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import { Settings as MockSettings } from "../mocks/gnome/Gio.js";
import { SETTINGS_OVERRIDES, SNAPSHOT_KEY, overrideId } from "../../lib/shared/gnome-overrides.js";

vi.mock("../../lib/extension/indicator.js", () => ({
  FeatureIndicator: class FeatureIndicator {
    quickSettingsItems = [];
    destroy() {}
  },
  FeatureMenuToggle: vi.fn(function FeatureMenuToggle() {
    this.destroy = vi.fn();
  }),
}));

// Fail enable() right after the override loop so it runs disable()'s restore
// path without building the whole extension (same seam as forge-tus6).
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
 * forge-7t96: the GNOME originals were snapshotted only in memory. After an exit
 * that skipped disable() (crash, X11 restart), dconf still held the override
 * values, so the next enable() captured []/false as the "originals" and every
 * later disable() wrote them back — native maximize, Super+L, edge-tiling etc.
 * stayed dead even after uninstalling Forge. The originals now persist in the
 * Forge `gnome-overrides-snapshot` key, written before the overrides.
 */
const getter = (desc) => (desc.type === "boolean" ? "get_boolean" : "get_strv");
const setter = (desc) => (desc.type === "boolean" ? "set_boolean" : "set_strv");
const userValue = (desc) => (desc.type === "boolean" ? true : [`<Super>user-${desc.key}`]);

describe("forge-7t96: GNOME originals survive an exit that skips disable()", () => {
  let dconf; // schemaId -> settings, shared by every extension instance like dconf
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
      dconf.get(desc.schemaId)[setter(desc)](desc.key, userValue(desc));
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

  function buildExtension() {
    const ext = new ForgeExtension();
    ext.getSettings = vi.fn(() => forgeSettings);
    return ext;
  }

  /** Apply every override the way enable() does, then "crash" (no disable()). */
  function enableThenCrash() {
    const ext = buildExtension();
    ext.settings = forgeSettings;
    ext._savedSettings = [];
    ext._gnomeSettings = new Map();
    for (const desc of SETTINGS_OVERRIDES) ext._applyOverride(desc);
  }

  function expectUserValues() {
    for (const desc of SETTINGS_OVERRIDES) {
      expect(
        dconf.get(desc.schemaId)[getter(desc)](desc.key),
        `${desc.schemaId} '${desc.key}' not restored`
      ).toEqual(userValue(desc));
    }
  }

  it("restores the real originals after a crashed session", () => {
    enableThenCrash();
    // The crash left every override in dconf.
    for (const desc of SETTINGS_OVERRIDES) {
      expect(dconf.get(desc.schemaId)[getter(desc)](desc.key)).toEqual(desc.newValue);
    }

    expect(() => buildExtension().enable()).toThrow(/stop after overrides/);

    expectUserValues();
    expect(forgeSettings.get_string(SNAPSHOT_KEY)).toBe("");
  });

  it("persists each original before writing its override", () => {
    const desc = SETTINGS_OVERRIDES.find((d) => d.key === "maximize");
    const gsettings = dconf.get(desc.schemaId);
    let snapshotAtWrite = null;
    const realSet = gsettings.set_strv.bind(gsettings);
    gsettings.set_strv = (key, value) => {
      if (key === "maximize" && value.length === 0) {
        snapshotAtWrite = JSON.parse(forgeSettings.get_string(SNAPSHOT_KEY));
      }
      realSet(key, value);
    };

    enableThenCrash();

    expect(snapshotAtWrite?.[overrideId(desc)]).toEqual(userValue(desc));
  });

  it("keeps a user's own value that equals the override value", () => {
    const desc = SETTINGS_OVERRIDES.find((d) => d.key === "edge-tiling");
    const gsettings = dconf.get(desc.schemaId);
    gsettings.set_boolean("edge-tiling", false); // user turned edge-tiling off in GNOME
    const ext = buildExtension();
    ext.settings = forgeSettings;
    ext._savedSettings = [];
    ext._gnomeSettings = new Map();

    ext._applyOverride(desc);
    ext._restoreOverride(desc); // Super+w: Forge tiling off

    expect(gsettings.get_boolean("edge-tiling")).toBe(false);
    expect(forgeSettings.get_string(SNAPSHOT_KEY)).toBe("");
  });

  it("restores a value the user set in GNOME before an unclean exit", () => {
    enableThenCrash();
    const desc = SETTINGS_OVERRIDES.find((d) => d.key === "minimize");
    const gsettings = dconf.get(desc.schemaId);
    gsettings.set_strv("minimize", ["<Super>m"]); // rebound in GNOME Settings over Forge's []
    enableThenCrash();

    expect(() => buildExtension().enable()).toThrow(/stop after overrides/);

    expect(gsettings.get_strv("minimize")).toEqual(["<Super>m"]);
    expect(forgeSettings.get_string(SNAPSHOT_KEY)).toBe("");
  });

  it("restores a crashed override the user has since opted out of", () => {
    enableThenCrash();
    forgeSettings.set_boolean("disable-edge-tiling", false);

    expect(() => buildExtension().enable()).toThrow(/stop after overrides/);

    expectUserValues();
    expect(forgeSettings.get_string(SNAPSHOT_KEY)).toBe("");
  });
});
