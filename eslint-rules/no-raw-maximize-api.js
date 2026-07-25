/*
 * Repo-local ESLint rule (forge-fhen.6): no-raw-maximize-api
 *
 * Bans the RAW Mutter maximize/unmaximize APIs everywhere EXCEPT the shim that
 * owns them (lib/extension/compat.js). All other call sites must go through the
 * version-dispatch shims in that file (Compat.maximize / Compat.unmaximize /
 * Compat.isMaximized / ...), so a Mutter API that drifts between releases is
 * handled in exactly one place.
 *
 * The raw Meta.Window methods this rule guards:
 *   - is_maximized, get_maximized, set_maximize_flags, set_unmaximize_flags,
 *     get_maximize_flags  -> snake_case; safe to ban by property name (the
 *     Compat shims are camelCase, so there is no naming collision).
 *   - maximize, unmaximize -> these COLLIDE with the Compat wrapper names
 *     (Compat.maximize / Compat.unmaximize). Banning them by bare property name
 *     would wrongly flag the CORRECT shim call sites. So these two are keyed on
 *     the RECEIVER: they are only reported when the member's object is NOT the
 *     `Compat` namespace identifier. This is a pragmatic receiver check (no full
 *     Meta.Window type inference); the codebase convention is that every correct
 *     call is `Compat.maximize(win)` / `Compat.unmaximize(win)`.
 *
 * compat.js itself is exempted wholesale (it is the one file allowed to touch
 * the raw APIs).
 */

"use strict";

// Snake_case raw APIs: unambiguous, ban by property name.
const RAW_SNAKE_METHODS = new Set([
  "is_maximized",
  "get_maximized",
  "set_maximize_flags",
  "set_unmaximize_flags",
  "get_maximize_flags",
]);

// Colliding names: only raw when the receiver is not the Compat namespace.
const COLLIDING_METHODS = new Set(["maximize", "unmaximize"]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban raw Mutter maximize/unmaximize APIs outside compat.js; use the Compat.* shims instead.",
    },
    schema: [],
    messages: {
      rawSnake:
        "Do not call the raw Mutter API `{{name}}(...)`; use the version-dispatch shim in lib/extension/compat.js (e.g. Compat.isMaximized / Compat.getMaximizeFlags).",
      rawMaximize:
        "Do not call the raw Meta.Window `.{{name}}(...)`; use `Compat.{{name}}(...)` from lib/extension/compat.js so Mutter version drift stays centralized.",
    },
  },

  create(context) {
    // ESLint 9 exposes context.filename; keep getFilename() fallback for safety.
    const filename =
      (typeof context.filename === "string" && context.filename) ||
      (typeof context.getFilename === "function" && context.getFilename()) ||
      "";

    // Exempt the shim file itself. Normalize separators for cross-platform
    // robustness, then match the repo-relative path exactly — a bare
    // `endsWith("/compat.js")` would wrongly exempt any future unrelated
    // compat.js in a different directory.
    const normalized = filename.replace(/\\/g, "/");
    if (normalized.endsWith("lib/extension/compat.js")) {
      return {};
    }

    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== "Identifier") return;
        const name = node.property.name;

        if (RAW_SNAKE_METHODS.has(name)) {
          context.report({ node: node.property, messageId: "rawSnake", data: { name } });
          return;
        }

        if (COLLIDING_METHODS.has(name)) {
          // Exempt the correct shim call sites: Compat.maximize / Compat.unmaximize.
          const obj = node.object;
          if (obj && obj.type === "Identifier" && obj.name === "Compat") return;
          context.report({ node: node.property, messageId: "rawMaximize", data: { name } });
        }
      },
    };
  },
};
