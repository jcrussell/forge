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
    const defaultSettingFile = this.defaultWindowConfigFile;
    if (defaultSettingFile) {
      const contents = this.loadFileContents(defaultSettingFile);
      if (contents) {
        return JSON.parse(contents);
      }
    }
    return null;
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
      const profileCustomSettingDir = Gio.File.new_for_path(path);
      if (!profileCustomSettingDir.query_exists(null)) {
        if (profileCustomSettingDir.make_directory_with_parents(null)) {
          const createdStream = customSettingFile.create(Gio.FileCreateFlags.NONE, null);
          const defaultContents = this.loadFileContents(defaultFile);
          Logger.trace(defaultContents);
          createdStream.write_all(defaultContents, null);
        }
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
    let windowConfigFile = this.windowConfigFile;
    let windowProps = null;
    // if (!windowConfigFile || !production) {
    if (!windowConfigFile) {
      windowConfigFile = this.defaultWindowConfigFile;
    }

    let [success, contents] = windowConfigFile.load_contents(null);
    if (success) {
      const windowConfigContents = imports.byteArray.toString(contents);
      Logger.trace(`${windowConfigContents}`);

      // Handle empty or invalid JSON gracefully (#415)
      try {
        if (windowConfigContents && windowConfigContents.trim().length > 0) {
          windowProps = JSON.parse(windowConfigContents);
        } else {
          Logger.warn("Window config file is empty, using default");
        }
      } catch (e) {
        Logger.error(`Failed to parse window config: ${e}. Using default.`);
      }
    }
    return windowProps;
  }

  set windowProps(props) {
    let windowConfigFile = this.windowConfigFile;
    // if (!windowConfigFile || !production) {
    if (!windowConfigFile) {
      windowConfigFile = this.defaultWindowConfigFile;
    }

    let windowConfigContents = JSON.stringify(props, null, 4);

    if (GLib.mkdir_with_parents(windowConfigFile.get_parent().get_path(), PERMISSIONS_MODE) === 0) {
      let [_, _tag] = windowConfigFile.replace_contents(
        windowConfigContents,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
    }
  }

  // ==================== Settings Config ====================

  /**
   * Get the path to the settings.json config file (if it exists)
   * @returns {Gio.File|null}
   */
  get settingsConfigFile() {
    const configPath = `${this.confDir}/config`;
    const settingsFile = GLib.build_filenamev([configPath, "settings.json"]);
    const file = Gio.File.new_for_path(settingsFile);
    if (file.query_exists(null)) {
      return file;
    }
    return null;
  }

  /**
   * Get the path where settings.json should be written
   * @returns {Gio.File}
   */
  get settingsConfigPath() {
    const configPath = `${this.confDir}/config`;
    const settingsFile = GLib.build_filenamev([configPath, "settings.json"]);
    return Gio.File.new_for_path(settingsFile);
  }

  /**
   * Load settings from settings.json if it exists
   * @returns {Object|null}
   */
  get settingsProps() {
    return this._loadJsonConfig(this.settingsConfigFile, "settings.json");
  }

  /**
   * Save settings to settings.json
   * @param {Object} props
   */
  set settingsProps(props) {
    this._saveJsonConfig(this.settingsConfigPath, props, "settings.json");
  }

  // ==================== Keybindings Config ====================

  /**
   * Get the path to the keybindings.json config file (if it exists)
   * @returns {Gio.File|null}
   */
  get keybindingsConfigFile() {
    const configPath = `${this.confDir}/config`;
    const keybindingsFile = GLib.build_filenamev([configPath, "keybindings.json"]);
    const file = Gio.File.new_for_path(keybindingsFile);
    if (file.query_exists(null)) {
      return file;
    }
    return null;
  }

  /**
   * Get the path where keybindings.json should be written
   * @returns {Gio.File}
   */
  get keybindingsConfigPath() {
    const configPath = `${this.confDir}/config`;
    const keybindingsFile = GLib.build_filenamev([configPath, "keybindings.json"]);
    return Gio.File.new_for_path(keybindingsFile);
  }

  /**
   * Load keybindings from keybindings.json if it exists
   * @returns {Object|null}
   */
  get keybindingsProps() {
    return this._loadJsonConfig(this.keybindingsConfigFile, "keybindings.json");
  }

  /**
   * Save keybindings to keybindings.json
   * @param {Object} props
   */
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
