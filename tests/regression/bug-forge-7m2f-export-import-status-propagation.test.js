import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfigSync } from "../../lib/shared/config-sync.js";

/**
 * Bug forge-7m2f (audit-2026-07b): forge-1n2v/forge-q9e5 fixed the PRODUCERS
 * last round — _saveJsonConfig, exportSettings/exportKeybindings and importAll
 * all report real status now — but exportAll() still threw its two booleans away
 * and four call sites ignored the result:
 *
 *   - prefs/portability.js _exportConfig: toasts "exported successfully" AND
 *     force-sets config-file-sync-enabled=true with nothing written, while
 *     _updateStatus() renders "Last export: Never" right underneath.
 *   - prefs/portability.js _importConfig: toasts "imported successfully" on a
 *     corrupt settings.json.
 *   - config-sync.js enablePortableConfig(): sets configFilesLoaded and
 *     config-file-sync-enabled unconditionally.
 *   - command.js ConfigExport keybinding: logs success regardless.
 *
 * importAll() reports PER FILE rather than a single boolean: it returns false
 * for a file that is merely absent, while _importConfig only requires that ONE
 * of the two exists — so a combined boolean cannot distinguish "half the config
 * imported fine" from "the import failed".
 */
describe("Bug forge-7m2f: export/import status reaches every caller", () => {
  afterEach(() => vi.restoreAllMocks());

  function makeSync({ saveOk = true, settingsProps = { version: 1 }, keybindingsProps } = {}) {
    const store = new Map();
    const settings = {
      get_value: () => ({ get_type_string: () => "s" }),
      get_string: (k) => store.get(k) ?? "",
      set_string: (k, v) => store.set(k, v),
      get_boolean: (k) => store.get(k) ?? false,
      set_boolean: (k, v) => store.set(k, v),
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
      settingsProps,
      keybindingsProps:
        keybindingsProps === undefined ? { version: 1, bindings: {} } : keybindingsProps,
      saveSettingsProps: () => saveOk,
      saveKeybindingsProps: () => saveOk,
    };
    return { sync: new ConfigSync({ configMgr, settings, kbdSettings: settings }), settings };
  }

  describe("exportAll", () => {
    it("returns false when the writes fail", () => {
      const { sync } = makeSync({ saveOk: false });
      expect(sync.exportAll()).toBe(false);
      sync.destroy();
    });

    it("returns true when both files are written", () => {
      const { sync } = makeSync({ saveOk: true });
      expect(sync.exportAll()).toBe(true);
      sync.destroy();
    });
  });

  describe("enablePortableConfig", () => {
    it("does not claim portable config exists when nothing was written", () => {
      const { sync, settings } = makeSync({ saveOk: false });

      expect(sync.enablePortableConfig()).toBe(false);

      expect(settings._store.get("config-file-sync-enabled")).toBeFalsy();
      expect(sync.configFilesLoaded).toBe(false);
      sync.destroy();
    });

    it("enables sync when the export succeeded", () => {
      const { sync, settings } = makeSync({ saveOk: true });

      expect(sync.enablePortableConfig()).toBe(true);

      expect(settings._store.get("config-file-sync-enabled")).toBe(true);
      expect(sync.configFilesLoaded).toBe(true);
      sync.destroy();
    });
  });

  describe("importAll reports per file", () => {
    it("reports both as failed when neither file is readable", () => {
      const { sync } = makeSync({ settingsProps: null, keybindingsProps: null });
      expect(sync.importAll()).toEqual({ settings: false, keybindings: false });
      sync.destroy();
    });

    it("distinguishes a good settings.json from an absent keybindings.json", () => {
      const { sync } = makeSync({ keybindingsProps: null });
      expect(sync.importAll()).toEqual({ settings: true, keybindings: false });
      sync.destroy();
    });

    it("reports both as imported when both files are good", () => {
      const { sync } = makeSync({});
      expect(sync.importAll()).toEqual({ settings: true, keybindings: true });
      sync.destroy();
    });
  });
});
