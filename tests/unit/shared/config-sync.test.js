import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { ConfigSync } from "../../../lib/shared/config-sync.js";

/**
 * ConfigSync behavioral tests
 *
 * Tests that settings round-trip correctly between GSettings and JSON config,
 * internal keys are excluded from exports, debounce batches rapid changes,
 * and destroy properly cleans up.
 */
describe("ConfigSync", () => {
  let configSync;
  let settings;
  let kbdSettings;
  let configMgr;

  /**
   * Creates a mock GSettings object that tracks GVariant types alongside values.
   * Each value is stored as { type, value } so get_value().get_type_string() works.
   */
  function createTypedSettings() {
    const store = new Map();
    const signals = {};

    const obj = {
      get_value: (key) => {
        const entry = store.get(key);
        if (!entry) {
          return { get_type_string: () => "s" };
        }
        return { get_type_string: () => entry.type };
      },
      get_boolean: (key) => store.get(key)?.value ?? false,
      set_boolean: (key, value) => {
        store.set(key, { type: "b", value });
      },
      get_uint: (key) => store.get(key)?.value ?? 0,
      set_uint: (key, value) => {
        store.set(key, { type: "u", value });
      },
      set_uint64: (key, value) => {
        store.set(key, { type: "u", value });
      },
      get_int: (key) => store.get(key)?.value ?? 0,
      set_int: (key, value) => {
        store.set(key, { type: "i", value });
      },
      get_string: (key) => store.get(key)?.value ?? "",
      set_string: (key, value) => {
        store.set(key, { type: "s", value });
      },
      get_double: (key) => store.get(key)?.value ?? 0.0,
      set_double: (key, value) => {
        store.set(key, { type: "d", value });
      },
      get_strv: (key) => store.get(key)?.value ?? [],
      set_strv: (key, value) => {
        store.set(key, { type: "as", value });
      },
      connect: (signal, callback) => {
        if (!signals[signal]) signals[signal] = [];
        const id = Math.floor(Math.random() * 100000) + 1;
        signals[signal].push({ id, callback });
        return id;
      },
      disconnect: (id) => {
        for (const signal in signals) {
          signals[signal] = signals[signal].filter((s) => s.id !== id);
        }
      },
      _emit: (signal, ...args) => {
        if (signals[signal]) {
          signals[signal].forEach((s) => s.callback(obj, ...args));
        }
      },
      _store: store,
      _signals: signals,
    };

    return obj;
  }

  /**
   * Creates a mock ConfigManager that stores settings/keybindings props in memory.
   */
  function createMockConfigMgr() {
    return {
      extensionPath: "/mock/extension/path",
      hasPortableConfig: () => false,
      _settingsProps: null,
      _keybindingsProps: null,
      get settingsProps() {
        return this._settingsProps;
      },
      set settingsProps(props) {
        this._settingsProps = props;
      },
      get keybindingsProps() {
        return this._keybindingsProps;
      },
      set keybindingsProps(props) {
        this._keybindingsProps = props;
      },
    };
  }

  beforeEach(() => {
    settings = createTypedSettings();
    kbdSettings = createTypedSettings();
    configMgr = createMockConfigMgr();

    configSync = new ConfigSync({
      configMgr,
      settings,
      kbdSettings,
    });
  });

  afterEach(() => {
    configSync.destroy();
  });

  describe("settings round-trip by type", () => {
    it("should round-trip boolean, uint, int, string, double, and strv settings", () => {
      // Set values of each GVariant type
      settings.set_boolean("tiling-mode-enabled", true);
      settings.set_uint("window-gap-size", 8);
      settings.set_int("window-margin-top", 5);
      settings.set_string("default-window-layout", "stacked");
      settings.set_double("focus-border-size", 2.5);
      settings.set_strv("workspace-skip-tile", ["1", "3"]);

      // Export to config manager
      configSync.exportSettings();
      expect(configMgr.settingsProps).not.toBeNull();

      // Modify all settings to different values
      settings.set_boolean("tiling-mode-enabled", false);
      settings.set_uint("window-gap-size", 0);
      settings.set_int("window-margin-top", 0);
      settings.set_string("default-window-layout", "split");
      settings.set_double("focus-border-size", 0);
      settings.set_strv("workspace-skip-tile", []);

      // Import from exported config
      configSync.importSettings();

      // Verify all values round-tripped correctly
      expect(settings.get_boolean("tiling-mode-enabled")).toBe(true);
      expect(settings.get_uint("window-gap-size")).toBe(8);
      expect(settings.get_int("window-margin-top")).toBe(5);
      expect(settings.get_string("default-window-layout")).toBe("stacked");
      expect(settings.get_double("focus-border-size")).toBe(2.5);
      expect(settings.get_strv("workspace-skip-tile")).toEqual(["1", "3"]);
    });
  });

  describe("internal keys are not exported", () => {
    it("should not include internal tracking keys in exported settings", () => {
      // Set some internal keys that ConfigSync should never export
      settings.set_boolean("config-file-sync-enabled", true);
      settings.set_uint("config-last-import", 123);
      settings.set_uint("config-last-export", 456);
      settings.set_boolean("css-updated", true);
      settings.set_string("css-last-update", "2024-01-01");
      settings.set_string("window-overrides-reload-trigger", "trigger");

      configSync.exportSettings();

      const exported = configMgr.settingsProps;
      // Gather all exported keys across all categories
      const allExportedKeys = [];
      for (const category of ["behavior", "appearance", "workspaces", "development", "other"]) {
        if (exported[category]) {
          allExportedKeys.push(...Object.keys(exported[category]));
        }
      }

      expect(allExportedKeys).not.toContain("config-last-import");
      expect(allExportedKeys).not.toContain("config-last-export");
      expect(allExportedKeys).not.toContain("config-file-sync-enabled");
      expect(allExportedKeys).not.toContain("css-updated");
      expect(allExportedKeys).not.toContain("css-last-update");
      expect(allExportedKeys).not.toContain("window-overrides-reload-trigger");
    });
  });

  describe("rapid changes produce one export", () => {
    it("should debounce rapid settings changes into a single export", () => {
      configSync.configFilesLoaded = true;
      configSync._connectSettingsSignals();

      // Capture the last timeout callback
      let lastCallback = null;
      const timeoutSpy = vi.spyOn(GLib, "timeout_add").mockImplementation((priority, delay, cb) => {
        lastCallback = cb;
        return 42;
      });

      // Trigger multiple rapid changes via settings signals
      settings._emit("changed", "tiling-mode-enabled");
      settings._emit("changed", "window-gap-size");
      settings._emit("changed", "focus-border-toggle");

      // No export should have occurred yet (debounced)
      expect(configMgr.settingsProps).toBeNull();

      // Fire the debounced callback
      lastCallback();

      // Now exactly one export should have happened
      expect(configMgr.settingsProps).not.toBeNull();
      expect(configMgr.keybindingsProps).not.toBeNull();

      timeoutSpy.mockRestore();
    });
  });

  describe("no export when config not loaded", () => {
    it("should not auto-export when configFilesLoaded is false", () => {
      // configFilesLoaded defaults to false
      expect(configSync.configFilesLoaded).toBe(false);

      // Manually connect signals (normally init() guards this, but testing the safety check)
      configSync._connectSettingsSignals();

      // Trigger a settings change
      settings._emit("changed", "tiling-mode-enabled");

      // No export should have occurred
      expect(configMgr.settingsProps).toBeNull();
      expect(configMgr.keybindingsProps).toBeNull();
    });
  });

  describe("keybinding round-trip", () => {
    it("should round-trip keybindings including string and strv types", () => {
      // Set up keybinding values
      kbdSettings.set_string("mod-mask-mouse-tile", "Super");
      kbdSettings.set_strv("focus-border-toggle", ["<Super>b"]);
      kbdSettings.set_strv("window-swap-left", ["<Super>Left", "<Super>h"]);
      kbdSettings.set_strv("con-split-layout-toggle", ["<Super>e"]);

      // Export keybindings
      configSync.exportKeybindings();
      expect(configMgr.keybindingsProps).not.toBeNull();
      expect(configMgr.keybindingsProps["mod-mask-mouse-tile"]).toBe("Super");
      expect(configMgr.keybindingsProps.bindings["focus-border-toggle"]).toEqual(["<Super>b"]);

      // Reset keybinding settings to different values
      kbdSettings.set_string("mod-mask-mouse-tile", "");
      kbdSettings.set_strv("focus-border-toggle", []);
      kbdSettings.set_strv("window-swap-left", []);
      kbdSettings.set_strv("con-split-layout-toggle", []);

      // Import from exported config
      configSync.importKeybindings();

      // Verify all keybindings round-tripped correctly
      expect(kbdSettings.get_string("mod-mask-mouse-tile")).toBe("Super");
      expect(kbdSettings.get_strv("focus-border-toggle")).toEqual(["<Super>b"]);
      expect(kbdSettings.get_strv("window-swap-left")).toEqual(["<Super>Left", "<Super>h"]);
      expect(kbdSettings.get_strv("con-split-layout-toggle")).toEqual(["<Super>e"]);
    });
  });

  describe("destroy cleans up", () => {
    it("should not trigger exports after destroy", () => {
      configSync.configFilesLoaded = true;
      configSync._connectSettingsSignals();

      // Destroy cleans up signals
      configSync.destroy();

      // Trigger a settings change — handler should be disconnected
      settings._emit("changed", "tiling-mode-enabled");

      // No export should occur
      expect(configMgr.settingsProps).toBeNull();
      expect(configMgr.keybindingsProps).toBeNull();
    });
  });
});
