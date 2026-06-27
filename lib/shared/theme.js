/*
 * This file is part of the Forge extension for GNOME
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

// Application imports
import { stringify, parse } from "../css/index.js";
import { production, PERMISSIONS_MODE } from "./settings.js";
import { Logger } from "./logger.js";

export class ThemeManagerBase extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  constructor({ configMgr, settings }) {
    super();
    this.configMgr = configMgr;
    this.settings = settings;
    this._importCss();
    this.defaultPalette = this.getDefaultPalette();

    // CSS version tag - increment when default stylesheet changes require user config update.
    this.cssTag = 38;

    // patchCss() is intentionally not called in constructor - it's triggered
    // by settings changes or explicitly called when CSS updates are detected.
  }

  /**
   * @param {string} value
   */
  addPx(value) {
    return `${value}px`;
  }

  /**
   * @param {string} value
   */
  removePx(value) {
    // A user stylesheet missing a rule yields undefined here (getCssProperty
    // returns {}); guard so getDefaults() doesn't throw and abort enable() (forge-lid6).
    return typeof value === "string" ? value.replace("px", "") : value;
  }

  getDefaultPalette() {
    return {
      tiled: this.getDefaults("tiled"),
      split: this.getDefaults("split"),
      floated: this.getDefaults("floated"),
      stacked: this.getDefaults("stacked"),
      tabbed: this.getDefaults("tabbed"),
    };
  }

  /**
   * The scheme name is in between the CSS selector name
   * E.g. window-tiled-color should return `tiled`
   * @param {string} selector
   */
  getColorSchemeBySelector(selector) {
    const parts = selector.split("-");
    return parts.length >= 3 ? parts[1] : null;
  }

  /**
   * @param {string} color
   */
  getDefaults(color) {
    return {
      color: this.getCssProperty(`.${color}`, "color").value,
      "border-width": this.removePx(this.getCssProperty(`.${color}`, "border-width").value),
      opacity: this.getCssProperty(`.${color}`, "opacity").value,
    };
  }

  /**
   * @param {any} selector
   */
  getCssRule(selector) {
    if (this.cssAst) {
      const rules = this.cssAst.stylesheet.rules;
      // return only the first match, Forge CSS authors should make sure class names are unique :)
      const matchRules = rules.filter(
        (r) => r.selectors && r.selectors.filter((s) => s === selector).length > 0
      );
      return matchRules.length > 0 ? matchRules[0] : {};
    }
    return {};
  }

  /**
   * @param {string} selector
   * @param {string} propertyName
   */
  getCssProperty(selector, propertyName) {
    const cssRule = this.getCssRule(selector);

    // Check both cssRule and declarations exist (#448)
    if (cssRule && cssRule.declarations) {
      const matchDeclarations = cssRule.declarations.filter((d) => d.property === propertyName);
      return matchDeclarations.length > 0 ? matchDeclarations[0] : {};
    }

    return {};
  }

  /**
   * @param {string} selector
   * @param {string} propertyName
   * @param {string} propertyValue
   */
  setCssProperty(selector, propertyName, propertyValue) {
    const cssProperty = this.getCssProperty(selector, propertyName);
    // Bug #312 fix: Check for valid property (not empty object from getCssProperty)
    if (cssProperty && cssProperty.value !== undefined) {
      // Idempotent: if the stylesheet already holds this value, do not rewrite it
      // or bump css-updated. Lets the once-on-init reconciliation (forge-w3ss) be a
      // no-op when consistent, so opening prefs does not spam stylesheet reloads.
      if (cssProperty.value === propertyValue) {
        return true;
      }
      cssProperty.value = propertyValue;
      this._updateCss();
      return true;
    }
    return false;
  }

  _getStylesheetFile() {
    let cssFile = this.configMgr.stylesheetFile;
    if (!cssFile || !production) {
      cssFile = this.configMgr.defaultStylesheetFile;
    }
    return cssFile;
  }

  /**
   * Returns the AST for stylesheet.css
   */
  _importCss() {
    let cssFile = this._getStylesheetFile();

    let [success, contents] = cssFile.load_contents(null);
    if (!success) return;

    const cssContents = new TextDecoder().decode(contents);
    // Parse in silent mode so a malformed USER stylesheet collects errors and
    // returns a partial AST instead of throwing out of enable() (forge-lid6).
    try {
      this.cssAst = parse(cssContents, { silent: true });
    } catch (e) {
      Logger.error(`Failed to parse stylesheet, falling back to default: ${e}`);
      const def = this.configMgr.defaultStylesheetFile; // getter can return null
      if (def) {
        const [ok, defContents] = def.load_contents(null);
        if (ok) this.cssAst = parse(new TextDecoder().decode(defContents), { silent: true });
      }
    }
  }

  /**
   * Ensures a stylesheet file is user-writable. Gio.copy() preserves the source's
   * permission mode, so a config stylesheet copied from the read-only install dir
   * (~0444) would otherwise reject replace_contents() silently and colors would never
   * persist. Bug #312 (forge-9sd). Only succeeds for files the user owns (always true
   * under ~/.config), so it is safe to call defensively before every write.
   * @param {Gio.File} file
   */
  _ensureWritable(file) {
    try {
      file.set_attribute_uint32("unix::mode", 0o644, Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {
      Logger.error(`theme: could not make ${file.get_path?.()} writable: ${e}`);
    }
  }

  /**
   * Writes the AST back to stylesheet.css and reloads the theme
   */
  _updateCss() {
    if (!this.cssAst) {
      return;
    }

    let cssFile = this._getStylesheetFile();

    const cssContents = stringify(this.cssAst);

    if (GLib.mkdir_with_parents(cssFile.get_parent().get_path(), PERMISSIONS_MODE) === 0) {
      this._ensureWritable(cssFile);
      let [success, _tag] = cssFile.replace_contents(
        cssContents,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
      if (success) {
        this.reloadStylesheet();
      } else {
        Logger.error(`theme: failed to write stylesheet ${cssFile.get_path?.()}`);
      }
    }
  }

  /**
   * Patches the CSS by overriding the $HOME/.config stylesheet.
   * Creates a backup of the existing config before overwriting.
   *
   * Note: Currently overwrites user customizations when defaults update.
   * Future improvements could merge changes to preserve user modifications.
   * A backup (.bak) is created to allow manual recovery of custom styles.
   */
  patchCss() {
    if (this._needUpdate()) {
      let originalCss = this.configMgr.defaultStylesheetFile;
      let configCss = this.configMgr.stylesheetFile;
      // forge-0h9k: stylesheetFile is null when the profile stylesheet doesn't
      // exist and seeding fails (e.g. ~/.config/forge is read-only). Bail out as
      // a no-op so enable() proceeds and tiling starts; css-last-update stays
      // unwritten so this retries on a future launch once the dir is writable.
      if (!configCss) return false;
      // Fix undefined.bak bug (#266) - get path from File object
      let copyConfigCss = Gio.File.new_for_path(configCss.get_path() + ".bak");
      let backupFine = configCss.copy(copyConfigCss, Gio.FileCopyFlags.OVERWRITE, null, null);
      // Bug #312 (forge-9sd): TARGET_DEFAULT_PERMS makes the copied config stylesheet
      // use the umask default (writable) instead of inheriting the read-only install-dir
      // perms, which would otherwise make later color writes fail silently.
      let copyFine = originalCss.copy(
        configCss,
        Gio.FileCopyFlags.OVERWRITE | Gio.FileCopyFlags.TARGET_DEFAULT_PERMS,
        null,
        null
      );
      if (backupFine && copyFine) {
        this.settings.set_uint("css-last-update", this.cssTag);
        return true;
      }
    }
    return false;
  }

  /**
   * Credits: ExtensionSystem.js:_callExtensionEnable()
   */
  reloadStylesheet() {
    throw new Error("Must implement reloadStylesheet");
  }

  _needUpdate() {
    let cssTag = this.cssTag;
    return this.settings.get_uint("css-last-update") !== cssTag;
  }
}

/**
 * Credits: Color Space conversion functions from CSS Tricks
 * https://css-tricks.com/converting-color-spaces-in-javascript/
 */
export function RGBAToHexA(rgba) {
  const sep = rgba.indexOf(",") > -1 ? "," : " ";
  let parts = rgba.substring(5).split(")")[0].split(sep);

  // Strip the slash if using space-separated syntax
  if (parts.indexOf("/") > -1) parts.splice(3, 1);

  parts.forEach((val, i) => {
    if (val.indexOf("%") > -1) {
      const p = val.slice(0, -1) / 100;
      parts[i] = i < 3 ? Math.round(p * 255) : p;
    }
  });

  const padHex = (s) => s.padStart(2, "0");
  const r = padHex((+parts[0]).toString(16));
  const g = padHex((+parts[1]).toString(16));
  const b = padHex((+parts[2]).toString(16));
  const a = padHex(Math.round(+parts[3] * 255).toString(16));

  return "#" + r + g + b + a;
}

export function hexAToRGBA(h) {
  let r = 0,
    g = 0,
    b = 0,
    a = 1;

  if (h.length === 5) {
    r = "0x" + h[1] + h[1];
    g = "0x" + h[2] + h[2];
    b = "0x" + h[3] + h[3];
    a = "0x" + h[4] + h[4];
  } else if (h.length === 9) {
    r = "0x" + h[1] + h[2];
    g = "0x" + h[3] + h[4];
    b = "0x" + h[5] + h[6];
    a = "0x" + h[7] + h[8];
  }
  a = +(a / 255).toFixed(3);

  return "rgba(" + +r + "," + +g + "," + +b + "," + a + ")";
}
