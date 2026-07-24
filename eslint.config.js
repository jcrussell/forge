// ESLint flat config with two blocks, each with a distinct global environment:
//
//   1. The extension's own ES-module sources (lib/**, extension.js, prefs.js) — linted under
//      js.configs.recommended plus repo-specific overrides (forge-fhen.3, blocking gate). These
//      `import` their GI namespaces via `gi://`, so those are NOT globals here.
//   2. The E2E test bridge JS (tests/e2e/framework/*.js, forge-mpt) — GJS snippets that run
//      inside gnome-shell's Eval scope (chiefly bridge.js, forge-1gu). Script scope, GI
//      namespaces are ambient globals. Consolidated out of ~40 Python-embedded fragments so
//      they can be linted for syntax/typos.
//
// Prettier handles formatting repo-wide; these blocks add correctness/static-analysis on top.
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

// Ambient globals available to the extension's ES-module sources at runtime under gnome-shell.
// Unlike the e2e bridge (script scope), the extension `import`s its GI namespaces
// (Meta/Clutter/St/...) via `gi://` — so those are NOT globals here and must NOT be listed
// (listing them would mask a genuinely missing import, which is exactly the forge-jnfk class we
// want no-undef to catch). Only the truly ambient host globals belong here.
const extensionGlobals = {
  globalThis: "readonly",
  global: "readonly",
  console: "readonly",
  log: "readonly",
  logError: "readonly",
  imports: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
};

module.exports = [
  {
    // Lint for the extension's own ES-module sources under js.configs.recommended plus the
    // repo-specific overrides below (forge-fhen.3 — blocking gate). recommended covers the
    // missing-import / use-before-init / dead-code classes (forge-jnfk, forge-3jx9) that were the
    // original advisory scope, and adds the rest of the correctness set; the overrides tune the
    // handful of rules whose defaults are too strict for this codebase's idioms.
    files: ["lib/**/*.js", "extension.js", "prefs.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: extensionGlobals,
    },
    rules: {
      // recommended first; the tuned overrides below take precedence (later keys win). `no-undef`
      // is part of recommended, so it is no longer listed explicitly.
      ...js.configs.recommended.rules,
      // classes:false — a method referencing a class declared later in the same module is
      // runtime-safe (the method runs after module load); flagging it is a false positive.
      // variables:true still catches genuine read-before-declaration (the forge-3jx9 class).
      "no-use-before-define": ["error", { functions: false, classes: false, variables: true }],
      // `_`-prefixed names are the repo's intentional-throwaway convention.
      "no-unused-vars": ["error", { caughtErrors: "none", args: "none", varsIgnorePattern: "^_" }],
      // `cond && obj.method()` / ternary side-effects are an idiomatic guard here (window.js:483).
      "no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      "no-import-assign": "error",
    },
  },
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
