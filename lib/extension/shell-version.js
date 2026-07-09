/*
 * This file is part of the Forge GNOME extension
 * https://github.com/forge-ext/forge
 *
 * Single source of truth for the running GNOME Shell / Mutter major version.
 *
 * This is a leaf module (imports nothing else in the extension) so that both
 * utils.js and compat.js can derive the version from it without creating an
 * import cycle (utils -> window -> compat would otherwise loop back).
 */

import { PACKAGE_VERSION } from "resource:///org/gnome/shell/misc/config.js";

/**
 * GNOME Shell (== Mutter) major version, e.g. 48 from "48.7".
 *
 * PACKAGE_VERSION is GNOME Shell's own build-time version, not the extension's.
 */
export const SHELL_MAJOR = parseInt(PACKAGE_VERSION.split(".")[0], 10);
