import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigManager } from "../../lib/shared/settings.js";

/**
 * forge-wzbl: windowProps read `this.windowConfigFile || this.defaultWindowConfigFile`,
 * which short-circuits on the user file merely EXISTING. A truncated or hand-edited
 * ~/.config/forge/config/windows.json therefore parsed to null and yielded
 * {overrides: []} — it never fell back to the bundled default, despite the comment
 * claiming it did.
 *
 * In a production build Logger is compiled out, so the parse error was invisible:
 * prefs -> Windows simply showed an empty list. Adding one rule then wrote that
 * single-entry array back over the file (REPLACE_DESTINATION, no backup),
 * destroying every float/tile override the user had.
 */

const BUNDLED = {
  overrides: [
    { wmClass: "Gnome-terminal", mode: "float" },
    { wmClass: "Steam", mode: "tile" },
  ],
};

const USER = { overrides: [{ wmClass: "Firefox", mode: "float" }] };

function createConfigManager({ userFileExists, userContents }) {
  const configMgr = new ConfigManager({ dir: { get_path: () => "/ext" } });

  const userFile = { get_path: () => "/home/u/.config/forge/config/windows.json" };
  const defaultFile = { get_path: () => "/ext/config/windows.json" };

  // Bypass the filesystem: model only the two things that matter here — whether
  // the user file exists, and what each path parses to.
  Object.defineProperty(configMgr, "windowConfigFile", {
    get: () => (userFileExists ? userFile : null),
  });
  Object.defineProperty(configMgr, "defaultWindowConfigFile", {
    get: () => defaultFile,
  });

  configMgr._loadJsonConfig = vi.fn((file) => {
    if (file === defaultFile) return BUNDLED;
    return userContents; // null models a parse failure
  });

  return configMgr;
}

describe("forge-wzbl: corrupt windows.json falls back to the bundled defaults", () => {
  let configMgr;

  it("returns the bundled overrides when the user file exists but fails to parse", () => {
    configMgr = createConfigManager({ userFileExists: true, userContents: null });

    const props = configMgr.windowProps;

    // The decisive assertion: NOT an empty list, which is what let a subsequent
    // save collapse the user's whole override set.
    expect(props.overrides).toHaveLength(2);
    expect(props).toEqual(BUNDLED);
    // It must actually have consulted the bundled file, not synthesized a default.
    expect(configMgr._loadJsonConfig).toHaveBeenCalledTimes(2);
  });

  it("falls back when the user file parses to a non-array overrides field", () => {
    configMgr = createConfigManager({
      userFileExists: true,
      userContents: { overrides: { notAnArray: true } },
    });

    expect(configMgr.windowProps).toEqual(BUNDLED);
  });

  it("prefers a valid user file over the bundled default", () => {
    configMgr = createConfigManager({ userFileExists: true, userContents: USER });

    expect(configMgr.windowProps).toEqual(USER);
    // Short-circuits: the bundled file is never read.
    expect(configMgr._loadJsonConfig).toHaveBeenCalledTimes(1);
  });

  it("reads the bundled default when no user file exists yet", () => {
    configMgr = createConfigManager({ userFileExists: false, userContents: null });

    expect(configMgr.windowProps).toEqual(BUNDLED);
  });

  it("still degrades to an empty list when BOTH sources are unusable", () => {
    configMgr = createConfigManager({ userFileExists: true, userContents: null });
    configMgr._loadJsonConfig = vi.fn(() => null);

    // Callers deref .overrides unguarded, so this must never be null/undefined.
    expect(configMgr.windowProps).toEqual({ overrides: [] });
  });
});
