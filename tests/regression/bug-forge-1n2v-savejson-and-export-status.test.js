import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../../lib/shared/settings.js";
import { ConfigSync } from "../../lib/shared/config-sync.js";
import { File } from "../mocks/gnome/Gio.js";

/**
 * Bug forge-1n2v (audit-2026-07 / C21) + forge-q9e5 (C23): _saveJsonConfig returned
 * nothing and swallowed failures (mkdir!=0 silent no-op; replace_contents catch only
 * logged), yet exportSettings/exportKeybindings set config-last-export and returned
 * true — prefs toasted "exported successfully" with no file written. importAll
 * likewise discarded importSettings/importKeybindings' false results.
 *
 * Fix: _saveJsonConfig returns a boolean; export propagates it; importAll returns the
 * combined import result.
 */
describe("Bug forge-1n2v/forge-q9e5: save/export/import report real success", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("_saveJsonConfig return value", () => {
    let cm;
    beforeEach(() => {
      cm = new ConfigManager({ dir: { get_path: () => "/test/extension" } });
    });

    function fileWith(replace) {
      const f = new File("/mock/settings.json");
      f.get_parent = () => ({ get_path: () => "/mock" });
      f.replace_contents = replace;
      return f;
    }

    it("returns true on a successful write", () => {
      const f = fileWith(vi.fn(() => [true, null]));
      expect(cm._saveJsonConfig(f, { a: 1 }, "settings.json")).toBe(true);
    });

    it("returns false when replace_contents throws a GError", () => {
      const f = fileWith(
        vi.fn(() => {
          throw new Error("GLib.Error g-io-error-quark: Permission denied");
        })
      );
      expect(cm._saveJsonConfig(f, { a: 1 }, "settings.json")).toBe(false);
    });
  });

  describe("ConfigSync propagates failures", () => {
    function makeSync({ saveOk = true, importOk = true } = {}) {
      const store = new Map();
      const settings = {
        get_value: () => ({ get_type_string: () => "s" }),
        get_string: (k) => store.get(k) ?? "",
        set_string: (k, v) => store.set(k, v),
        get_boolean: () => false,
        set_boolean: () => {},
        get_uint: () => 0,
        set_uint: () => {},
        set_uint64: (k, v) => store.set(k, v),
        get_int: () => 0,
        set_int: () => {},
        get_double: () => 0,
        set_double: () => {},
        get_strv: () => [],
        set_strv: () => {},
        connect: () => 1,
        disconnect: () => {},
        _store: store,
      };
      const configMgr = {
        hasPortableConfig: () => false,
        getConfigMtime: () => 0,
        // Import source: null props => importSettings/importKeybindings return false.
        settingsProps: importOk ? { version: 1 } : null,
        keybindingsProps: importOk ? { version: 1, bindings: {} } : null,
        saveSettingsProps: () => saveOk,
        saveKeybindingsProps: () => saveOk,
      };
      return { sync: new ConfigSync({ configMgr, settings, kbdSettings: settings }), settings };
    }

    it("exportSettings returns false and does not stamp last-export when the write fails", () => {
      const { sync, settings } = makeSync({ saveOk: false });
      expect(sync.exportSettings()).toBe(false);
      expect(settings._store.has("config-last-export")).toBe(false);
      sync.destroy();
    });

    it("exportSettings returns true on a successful write", () => {
      const { sync } = makeSync({ saveOk: true });
      expect(sync.exportSettings()).toBe(true);
      sync.destroy();
    });

    it("importAll returns false when the config files are missing/corrupt", () => {
      const { sync } = makeSync({ importOk: false });
      expect(sync.importAll()).toBe(false);
      sync.destroy();
    });
  });
});
