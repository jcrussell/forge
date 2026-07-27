import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import { Settings as MockSettings } from "../mocks/gnome/Gio.js";
import { SETTINGS_OVERRIDES } from "../../lib/shared/gnome-overrides.js";

vi.mock("../../lib/extension/indicator.js", () => ({
  FeatureIndicator: class FeatureIndicator {
    quickSettingsItems = [];
    destroy() {}
  },
  FeatureMenuToggle: vi.fn(function FeatureMenuToggle() {
    this.destroy = vi.fn();
  }),
}));

// The realistic throw site: config import writes GSettings and can fail on a
// corrupt/unreadable ~/.config/forge.
vi.mock("../../lib/shared/config-sync.js", () => ({
  ConfigSync: class ConfigSync {
    init() {
      throw new Error("simulated config import failure");
    }
    destroy() {}
  },
}));

import ForgeExtension from "../../extension.js";

/**
 * forge-tus6: enable() applies ~9 GNOME overrides (native maximize/unmaximize/
 * minimize, mutter edge-tiling/auto-maximize, Super+L, ...) and only disable()
 * restores them. GNOME Shell's _callExtensionEnable catches a throw from
 * enable(), marks the extension ERROR and does NOT call disable() — so a failure
 * anywhere after the override loop left those written to the user's dconf
 * permanently, surviving even an uninstall.
 */

/** Originals we seed so a restore is observable (must differ from the override). */
function seedOriginal(desc) {
  return desc.type === "boolean" ? true : [`<Super>original-${desc.key}`];
}

describe("forge-tus6: a failed enable() must not leave GNOME settings clobbered", () => {
  let created;
  let realSchemaSource;
  let RealSettings;

  beforeEach(() => {
    created = new Map();
    RealSettings = Gio.Settings;
    realSchemaSource = Gio.SettingsSchemaSource;

    // The mock Gio has no SettingsSchemaSource; _applyOverride probes it as a
    // crash guard (forge-rj4x). Report every schema/key present.
    Gio.SettingsSchemaSource = {
      get_default: () => ({ lookup: () => ({ has_key: () => true }) }),
    };

    // Record every GNOME Gio.Settings the extension constructs, pre-seeded with
    // the "user's" original values.
    Gio.Settings = class RecordingSettings extends MockSettings {
      constructor(props) {
        const schemaId = typeof props === "string" ? props : props?.schemaId;
        super(schemaId);
        this.schema_id = schemaId;
        for (const desc of SETTINGS_OVERRIDES) {
          if (desc.schemaId !== schemaId) continue;
          const setter = desc.type === "boolean" ? "set_boolean" : "set_strv";
          this[setter](desc.key, seedOriginal(desc));
        }
        created.set(schemaId, this);
      }
    };
  });

  afterEach(() => {
    Gio.Settings = RealSettings;
    Gio.SettingsSchemaSource = realSchemaSource;
  });

  function buildExtension() {
    const ext = new ForgeExtension();
    const forgeSettings = new MockSettings("org.gnome.shell.extensions.forge");
    // Ungate every gated override so all of them actually apply.
    forgeSettings.set_boolean("disable-edge-tiling", true);
    forgeSettings.set_boolean("tiling-mode-enabled", true);
    ext.getSettings = vi.fn(() => forgeSettings);
    return ext;
  }

  it("restores every applied override when enable() throws, and rethrows", () => {
    const ext = buildExtension();

    expect(() => ext.enable()).toThrow(/simulated config import failure/);

    // The overrides were genuinely applied first — otherwise this test would
    // pass vacuously against an enable() that never got that far.
    expect(created.size).toBeGreaterThan(0);

    for (const desc of SETTINGS_OVERRIDES) {
      const gsettings = created.get(desc.schemaId);
      expect(gsettings, `no Gio.Settings built for ${desc.schemaId}`).toBeDefined();
      const getter = desc.type === "boolean" ? "get_boolean" : "get_strv";
      expect(
        gsettings[getter](desc.key),
        `${desc.schemaId} '${desc.key}' was left overridden after a failed enable()`
      ).toEqual(seedOriginal(desc));
    }
  });

  it("leaves no partially-constructed state behind after the failed enable()", () => {
    const ext = buildExtension();

    expect(() => ext.enable()).toThrow();

    expect(ext.extWm).toBeNull();
    expect(ext.keybindings).toBeNull();
    expect(ext.cheatsheet).toBeNull();
    expect(ext.configSync).toBeNull();
    expect(ext.settings).toBeNull();
    expect(ext._savedSettings).toBeNull();
  });
});
