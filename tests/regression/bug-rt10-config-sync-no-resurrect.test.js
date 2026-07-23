import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { ConfigSync } from "../../lib/shared/config-sync.js";

/**
 * Bug forge-rt10: config-sync auto-export resurrects a user-deleted portable
 * config file.
 *
 * The debounced auto-export called exportAll(), which unconditionally rewrites
 * BOTH settings.json and keybindings.json. The only guard bailed only when
 * NEITHER file exists (hasPortableConfig is OR), so:
 *   (1) deleting ONE file → the next settings change recreates it, and
 *   (2) deleting BOTH within the ~500ms debounce window → both recreated
 *       (the guard runs at signal time, before the timer fires).
 *
 * Fix: the auto path (_autoExport) writes only files that currently exist,
 * re-checking per file at fire time. Explicit Export (exportAll via the prefs
 * button / enablePortableConfig) is unchanged and may still (re)create both.
 */
describe("Bug forge-rt10: auto-export must not resurrect deleted portable files", () => {
  let configSync;
  let settings;
  let kbdSettings;
  let configMgr;

  // Minimal GSettings stub: enough for signal emission + the getters ConfigSync
  // touches during an auto-export.
  function createSettings() {
    const store = new Map();
    const signals = {};
    const obj = {
      get_value: (key) => {
        const e = store.get(key);
        return { get_type_string: () => e?.type ?? "s" };
      },
      get_boolean: (k) => store.get(k)?.value ?? false,
      set_boolean: (k, v) => store.set(k, { type: "b", value: v }),
      get_uint: (k) => store.get(k)?.value ?? 0,
      set_uint: (k, v) => store.set(k, { type: "u", value: v }),
      set_uint64: (k, v) => store.set(k, { type: "u", value: v }),
      get_int: (k) => store.get(k)?.value ?? 0,
      set_int: (k, v) => store.set(k, { type: "i", value: v }),
      get_string: (k) => store.get(k)?.value ?? "",
      set_string: (k, v) => store.set(k, { type: "s", value: v }),
      get_double: (k) => store.get(k)?.value ?? 0.0,
      set_double: (k, v) => store.set(k, { type: "d", value: v }),
      get_strv: (k) => store.get(k)?.value ?? [],
      set_strv: (k, v) => store.set(k, { type: "as", value: v }),
      connect: (signal, callback) => {
        if (!signals[signal]) signals[signal] = [];
        const id = signals[signal].length + 1;
        signals[signal].push({ id, callback });
        return id;
      },
      disconnect: () => {},
      _emit: (signal, ...args) => {
        (signals[signal] || []).forEach((s) => s.callback(obj, ...args));
      },
    };
    return obj;
  }

  /**
   * ConfigManager mock whose per-file existence is a mutable flag. Deleting a
   * file flips its flag to false, so settingsConfigFile / keybindingsConfigFile
   * return null (mirroring the real getters' query_exists()), and getConfigMtime
   * returns null — exactly what an on-disk delete looks like. _writes counts how
   * many times each file was actually (re)written.
   */
  function createMockConfigMgr() {
    return {
      extensionPath: "/mock/extension/path",
      _exists: { settings: true, keybindings: true },
      _writes: { settings: 0, keybindings: 0 },
      _mtimes: { settings: 1, keybindings: 1 },
      _settingsProps: null,
      _keybindingsProps: null,
      get settingsConfigFile() {
        return this._exists.settings ? { __file: "settings.json" } : null;
      },
      get keybindingsConfigFile() {
        return this._exists.keybindings ? { __file: "keybindings.json" } : null;
      },
      hasPortableConfig() {
        return this.settingsConfigFile !== null || this.keybindingsConfigFile !== null;
      },
      getConfigMtime(name) {
        return this._exists[name] ? this._mtimes[name] : null;
      },
      get settingsProps() {
        return this._settingsProps;
      },
      set settingsProps(props) {
        // Writing (re)creates the file.
        this._settingsProps = props;
        this._exists.settings = true;
        this._writes.settings += 1;
        this._mtimes.settings += 1;
      },
      get keybindingsProps() {
        return this._keybindingsProps;
      },
      set keybindingsProps(props) {
        this._keybindingsProps = props;
        this._exists.keybindings = true;
        this._writes.keybindings += 1;
        this._mtimes.keybindings += 1;
      },
      // forge-1n2v: export now writes via the boolean-returning method form.
      saveSettingsProps(props) {
        this.settingsProps = props;
        return true;
      },
      saveKeybindingsProps(props) {
        this.keybindingsProps = props;
        return true;
      },
    };
  }

  // Capture the debounced export callback so a test can fire it deterministically.
  function captureDebounce() {
    let cb = null;
    vi.spyOn(GLib, "timeout_add").mockImplementation((_priority, _delay, fn) => {
      cb = fn;
      return 1;
    });
    return () => cb && cb();
  }

  beforeEach(() => {
    settings = createSettings();
    kbdSettings = createSettings();
    configMgr = createMockConfigMgr();
    configSync = new ConfigSync({ configMgr, settings, kbdSettings });
    configSync.configFilesLoaded = true;
    configSync._connectSettingsSignals();
  });

  afterEach(() => {
    configSync.destroy();
    vi.restoreAllMocks();
  });

  it("does not resurrect settings.json when only it was deleted (partial deletion)", () => {
    // User deletes settings.json by hand; keybindings.json stays.
    configMgr._exists.settings = false;
    expect(configMgr.hasPortableConfig()).toBe(true); // guard still passes (OR)

    const fire = captureDebounce();
    settings._emit("changed", "tiling-mode-enabled");
    fire();

    // settings.json must NOT be recreated; the surviving keybindings.json may
    // re-export harmlessly.
    expect(configMgr._writes.settings).toBe(0);
    expect(configMgr.settingsConfigFile).toBeNull();
  });

  it("does not resurrect keybindings.json when only it was deleted (partial deletion)", () => {
    configMgr._exists.keybindings = false;
    expect(configMgr.hasPortableConfig()).toBe(true);

    const fire = captureDebounce();
    settings._emit("changed", "tiling-mode-enabled");
    fire();

    expect(configMgr._writes.keybindings).toBe(0);
    expect(configMgr.keybindingsConfigFile).toBeNull();
  });

  it("does not resurrect either file when both are deleted within the debounce window", () => {
    // Both files exist when the change fires, so the signal-time guard passes and
    // the timer is armed...
    const fire = captureDebounce();
    settings._emit("changed", "tiling-mode-enabled");

    // ...then the user deletes BOTH before the ~500ms debounce callback runs.
    configMgr._exists.settings = false;
    configMgr._exists.keybindings = false;

    fire();

    expect(configMgr._writes.settings).toBe(0);
    expect(configMgr._writes.keybindings).toBe(0);
  });

  it("still auto-exports normally when both files exist (no regression)", () => {
    const fire = captureDebounce();
    settings._emit("changed", "tiling-mode-enabled");
    fire();

    expect(configMgr._writes.settings).toBe(1);
    expect(configMgr._writes.keybindings).toBe(1);
  });
});
