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

// Gnome imports
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
        if (!profileCustomSettingDir.query_exists(null)) {
          if (profileCustomSettingDir.make_directory_with_parents(null)) {
            const defaultContents = defaultFile ? this.loadFileContents(defaultFile) : undefined;
            Logger.trace(defaultContents);
            if (defaultContents !== undefined) {
              const createdStream = customSettingFile.create(Gio.FileCreateFlags.NONE, null);
              createdStream.write_all(defaultContents, null);
            }
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
      const stringContents = imports.byteArray.toString(contents);
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
        const stringContents = imports.byteArray.toString(contents);
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
    const parentPath = configFile.get_parent().get_path();

    if (GLib.mkdir_with_parents(parentPath, PERMISSIONS_MODE) === 0) {
      try {
        configFile.replace_contents(
          contents,
          null,
          false,
          Gio.FileCreateFlags.REPLACE_DESTINATION,
          null
        );
        Logger.trace(`Saved ${configName} to ${configFile.get_path()}`);
      } catch (e) {
        Logger.error(`Failed to save ${configName}: ${e}`);
      }
    }
  }

  get windowProps() {
    // forge-96e (#515): the bundled default (config/windows.json) is already the
    // `||` fallback, so the {overrides:[]} default below only fires when BOTH the
    // user file and the bundled default are unreadable/corrupt. Coalesce on the
    // RESULT so callers never deref `.overrides` on null/{}/an array and crash.
    const props = this._loadJsonConfig(
      this.windowConfigFile || this.defaultWindowConfigFile,
      "window config"
    );
    if (props && Array.isArray(props.overrides)) return props;
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
    this._saveJsonConfig(this.settingsConfigPath, props, "settings.json");
  }

  // ==================== Keybindings Config ====================

  get keybindingsConfigFile() {
    return this._getConfigFile("keybindings.json");
  }

  get keybindingsConfigPath() {
    return this._getConfigPath("keybindings.json");
  }

  get keybindingsProps() {
    return this._loadJsonConfig(this.keybindingsConfigFile, "keybindings.json");
  }

  set keybindingsProps(props) {
    this._saveJsonConfig(this.keybindingsConfigPath, props, "keybindings.json");
  }

  /**
   * Check if portable config files exist
   * @returns {boolean}
   */
  hasPortableConfig() {
    return this.settingsConfigFile !== null || this.keybindingsConfigFile !== null;
  }
}
