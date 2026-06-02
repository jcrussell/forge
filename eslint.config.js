// ESLint flat config for the E2E test bridge JS (forge-mpt).
//
// Scope: tests/e2e/framework/*.js only — the GJS snippets that run inside gnome-shell's
// Eval scope (chiefly bridge.js, forge-1gu). Those used to be ~40 fragments embedded in
// Python strings; now that they live in real .js files they can be linted for syntax/typos,
// which was a stated reason for the consolidation. The rest of the repo (the extension's own
// ES-module sources) is intentionally NOT covered here — Prettier handles formatting repo-wide
// and these GJS files have a different global environment than the extension modules.
//
// CommonJS file (the package has no "type":"module"), so ESLint 9 loads it as a flat config.

const js = require("@eslint/js");

// gnome-shell Eval-scope globals. @girs/* provides TypeScript *typings*, which do nothing for
// ESLint's no-undef — the globals must be declared here explicitly so `global`, `imports`, the
// GI namespaces, etc. resolve as defined rather than flagged. `global` (the gnome-shell global
// object, e.g. global.workspace_manager) is the one the inline /* global Main, globalThis */
// directive in bridge.js omits, so it MUST be listed here. Clutter/St are captured via
// imports.gi in bridge.js (forge-9q3 folded the virtual-input + overlay helpers in); listed
// here so the config is correct whether or not that change has landed.
//
// NOTE: `Main` and `globalThis` are intentionally NOT listed — bridge.js declares them in its
// own `/* global Main, globalThis */` directive, and listing them here too trips no-redeclare.
// Keeping them inline avoids touching bridge.js (forge-mpt is tooling-only); everything the
// inline directive lacks is supplied below.
const gjsGlobals = {
  global: "readonly",
  imports: "readonly",
  Meta: "readonly",
  Clutter: "readonly",
  St: "readonly",
  Gio: "readonly",
  GLib: "readonly",
  log: "readonly",
  logError: "readonly",
  print: "readonly",
  printerr: "readonly",
};

module.exports = [
  {
    files: ["tests/e2e/framework/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      // GJS Eval scope is script, not module — bridge.js is an IIFE, not an ES module.
      sourceType: "script",
      globals: gjsGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Unused catch bindings (`catch (e) { return "false"; }`) are a common GJS idiom in the
      // bridge; ESLint 9 flags them by default (caughtErrors: "all"). Keep real unused-variable
      // detection, just not for catch params.
      "no-unused-vars": ["error", { caughtErrors: "none" }],
      // Empty `catch (e) {}` (best-effort cleanup that intentionally swallows) is also idiomatic
      // here; allow the empty catch but keep no-empty for every other empty block.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
