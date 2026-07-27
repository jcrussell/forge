/*
 * This file is part of the Forge Window Manager extension for Gnome 3
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import { Logger } from "./logger.js";

// Dev or Prod mode, see Makefile:debug
export const production = true;

// File permission mode for creating config directories and files
export const PERMISSIONS_MODE = 0o744;

export class ConfigManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  #confDir = GLib.get_user_config_dir();

  constructor({ dir }) {
    super();
    this.extensionPath = dir.get_path();
  }

  get confDir() {
    return `${this.#confDir}/forge`;
  }

  get defaultStylesheetFile() {
    const defaultStylesheet = GLib.build_filenamev([this.extensionPath, `stylesheet.css`]);

    Logger.trace(`default-stylesheet: ${defaultStylesheet}`);

    const defaultStylesheetFile = Gio.File.new_for_path(defaultStylesheet);
    if (defaultStylesheetFile.query_exists(null)) {
      return defaultStylesheetFile;
    }
    return null;
  }

  get stylesheetFile() {
    const profileSettingPath = `${this.confDir}/stylesheet/forge`;
    const settingFile = "stylesheet.css";
    const defaultSettingFile = this.defaultStylesheetFile;
    return this.loadFile(profileSettingPath, settingFile, defaultSettingFile);
  }

  get defaultWindowConfigFile() {
    const defaultWindowConfig = GLib.build_filenamev([
      this.extensionPath,
      `config`,
      `windows.json`,
    ]);

    Logger.trace(`default-window-config: ${defaultWindowConfig}`);
    const defaultWindowConfigFile = Gio.File.new_for_path(defaultWindowConfig);

    if (defaultWindowConfigFile.query_exists(null)) {
      return defaultWindowConfigFile;
    }
    return null;
  }

  loadDefaultWindowConfigContents() {
    // forge-96e (#515): route through the guarded loader (no unguarded
    // JSON.parse) and always hand back an overrides-safe shape — the prefs
    // "Reset" button derefs .overrides on the result.
    return (
      this._loadJsonConfig(this.defaultWindowConfigFile, "default window config") ?? {
        overrides: [],
      }
    );
  }

  get windowConfigFile() {
    const profileSettingPath = `${this.confDir}/config`;
    const settingFile = "windows.json";
    const defaultSettingFile = this.defaultWindowConfigFile;
    return this.loadFile(profileSettingPath, settingFile, defaultSettingFile);
  }

  loadFile(path, file, defaultFile) {
    const customSetting = GLib.build_filenamev([path, file]);
    Logger.trace(`custom-setting-file: ${customSetting}`);

    const customSettingFile = Gio.File.new_for_path(customSetting);
    if (customSettingFile.query_exists(null)) {
      return customSettingFile;
    } else {
      // First run: seed the profile copy from the bundled default. Every GIO
      // call here throws on failure (mkdir on a racing/readonly path, create()
      // losing a race with the prefs process, a missing bundled default) and
      // this runs from the windowProps getter — never let it escape.
      try {
        const profileCustomSettingDir = Gio.File.new_for_path(path);
        // forge-s150: seed whenever the target FILE is missing, not only when the
        // whole profile dir is absent. After a patchCss the dir persists (it holds
        // stylesheet.css.bak), so deleting just stylesheet.css left it unseeded
        // forever — patchCss became a permanent no-op. Ensure the dir exists, then
        // (re)create the file from defaults and return it so it is usable at once.
        if (
          profileCustomSettingDir.query_exists(null) ||
          profileCustomSettingDir.make_directory_with_parents(null)
        ) {
          const defaultContents = defaultFile ? this.loadFileContents(defaultFile) : undefined;
          Logger.trace(defaultContents);
          if (defaultContents !== undefined) {
            const createdStream = customSettingFile.create(Gio.FileCreateFlags.NONE, null);
            createdStream.write_all(new TextEncoder().encode(defaultContents), null);
            return customSettingFile;
          }
        }
      } catch (e) {
        Logger.error(`Failed to seed ${file} from defaults: ${e}`);
      }
    }

    return null;
  }

  loadFileContents(configFile) {
    let [success, contents] = configFile.load_contents(null);
    if (success) {
      const stringContents = new TextDecoder().decode(contents);
      return stringContents;
    }
  }

  /**
   * Load and parse JSON from a config file
   * @param {Gio.File|null} configFile - The config file to load
   * @param {string} configName - Name for error messages
   * @returns {Object|null} Parsed JSON object or null
   */
  _loadJsonConfig(configFile, configName) {
    if (!configFile) {
      return null;
    }

    try {
      let [success, contents] = configFile.load_contents(null);
      if (success) {
        const stringContents = new TextDecoder().decode(contents);
        if (stringContents && stringContents.trim().length > 0) {
          return JSON.parse(stringContents);
        } else {
          Logger.warn(`${configName} is empty`);
        }
      }
    } catch (e) {
      Logger.error(`Failed to parse ${configName}: ${e}`);
    }
    return null;
  }

  /**
   * Save JSON to a config file
   * @param {Gio.File} configFile - The config file to save to
   * @param {Object} props - The object to serialize
   * @param {string} configName - Name for log messages
   * @param {number} [indent=2] - JSON indentation
   */
  _saveJsonConfig(configFile, props, configName, indent = 2) {
    const contents = JSON.stringify(props, null, indent);
    const parentPath = configFile.get_parent()?.get_path();

    // forge-1n2v: return a real success flag. Previously a mkdir failure was a
    // silent no-op and a write error only logged, yet Export still reported
    // success and updated last-export with no file written. Callers now propagate
    // this so the prefs "exported successfully" toast reflects reality.
    if (!parentPath || GLib.mkdir_with_parents(parentPath, PERMISSIONS_MODE) !== 0) {
      Logger.error(`Failed to save ${configName}: could not create ${parentPath}`);
      return false;
    }
    try {
      configFile.replace_contents(
        new TextEncoder().encode(contents),
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
      Logger.trace(`Saved ${configName} to ${configFile.get_path()}`);
      return true;
    } catch (e) {
      Logger.error(`Failed to save ${configName}: ${e}`);
      return false;
    }
  }

  get windowProps() {
    // forge-96e (#515): coalesce on the RESULT so callers never deref `.overrides`
    // on null/{}/an array and crash.
    //
    // forge-wzbl: fall back on a PARSE failure, not just a missing file. The old
    // `this.windowConfigFile || this.defaultWindowConfigFile` short-circuited on
    // the user file merely EXISTING, so a truncated or hand-edited windows.json
    // returned {overrides: []} and never reached the bundled default. The parse
    // error is invisible in a production build (Logger is compiled out), so prefs
    // showed an empty Windows list; adding one rule then wrote that single-entry
    // array back over the file, destroying every float/tile override the user had.
    // Reading the bundled default instead keeps the list populated, so a later
    // save can't silently collapse it.
    const isValid = (props) => props && Array.isArray(props.overrides);

    if (this.windowConfigFile) {
      const userProps = this._loadJsonConfig(this.windowConfigFile, "window config");
      if (isValid(userProps)) return userProps;
      Logger.error("window config is unreadable or malformed; using the bundled defaults");
    }

    const defaultProps = this._loadJsonConfig(
      this.defaultWindowConfigFile,
      "default window config"
    );
    if (isValid(defaultProps)) return defaultProps;
    return { overrides: [] };
  }

  get windowConfigPath() {
    return this._getConfigPath("windows.json");
  }

  set windowProps(props) {
    // forge-3sv2: always write to the user config path (like settingsProps /
    // keybindingsProps). The old fallback to defaultWindowConfigFile targeted the
    // read-only bundled install file, so the first override on a fresh profile was
    // silently lost. _saveJsonConfig creates the file if it does not exist yet.
    this._saveJsonConfig(this.windowConfigPath, props, "window config", 4);
  }

  // ==================== Config File Helpers ====================

  /**
   * Get a config file if it exists, or null
   * @param {string} fileName - Config file name (e.g., "settings.json")
   * @returns {Gio.File|null}
   */
  _getConfigFile(fileName) {
    const filePath = GLib.build_filenamev([`${this.confDir}/config`, fileName]);
    const file = Gio.File.new_for_path(filePath);
    return file.query_exists(null) ? file : null;
  }

  /**
   * Get the path where a config file should be written
   * @param {string} fileName - Config file name (e.g., "settings.json")
   * @returns {Gio.File}
   */
  _getConfigPath(fileName) {
    return Gio.File.new_for_path(GLib.build_filenamev([`${this.confDir}/config`, fileName]));
  }

  // ==================== Settings Config ====================

  get settingsConfigFile() {
    return this._getConfigFile("settings.json");
  }

  get settingsConfigPath() {
    return this._getConfigPath("settings.json");
  }

  get settingsProps() {
    return this._loadJsonConfig(this.settingsConfigFile, "settings.json");
  }

  set settingsProps(props) {
    this.saveSettingsProps(props);
  }

  // forge-1n2v: method form returns the write result so ConfigSync.exportSettings
  // can report a real failure (the setter can't return).
  saveSettingsProps(props) {
    return this._saveJsonConfig(this.settingsConfigPath, props, "settings.json");
  }

  // ==================== Keybindings Config ====================

  get keybindingsConfigFile() {
    return this._getConfigFile("keybindings.json");
  }

  get keybindingsConfigPath() {
    return this._getConfigPath("keybindings.json");
  }

  /**
   * On-disk modification time of a portable config file as a comparable number
   * (microseconds since epoch), or null if the file is absent / cannot be
   * stat'd. ConfigSync uses this to detect out-of-band writes before its
   * debounced auto-export, so it won't clobber a prefs Export/Import or a hand
   * edit (forge-nn0m).
   * @param {"settings"|"keybindings"} name
   * @returns {number|null}
   */
  getConfigMtime(name) {
    const file = name === "settings" ? this.settingsConfigFile : this.keybindingsConfigFile;
    if (!file) return null;
    try {
      const info = file.query_info(
        "time::modified,time::modified-usec",
        Gio.FileQueryInfoFlags.NONE,
        null
      );
      const sec = info.get_attribute_uint64("time::modified");
      const usec = info.get_attribute_uint32("time::modified-usec");
      return sec * 1000000 + usec;
    } catch (e) {
      return null;
    }
  }

  get keybindingsProps() {
    return this._loadJsonConfig(this.keybindingsConfigFile, "keybindings.json");
  }

  set keybindingsProps(props) {
    this.saveKeybindingsProps(props);
  }

  // forge-1n2v: method form returns the write result (see saveSettingsProps).
  saveKeybindingsProps(props) {
    return this._saveJsonConfig(this.keybindingsConfigPath, props, "keybindings.json");
  }

  /**
   * Check if portable config files exist
   * @returns {boolean}
   */
  hasPortableConfig() {
    return this.settingsConfigFile !== null || this.keybindingsConfigFile !== null;
  }
}
