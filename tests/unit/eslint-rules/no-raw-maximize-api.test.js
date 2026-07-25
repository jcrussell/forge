import { RuleTester } from "eslint";
import rule from "../../../eslint-rules/no-raw-maximize-api.js";

// ESLint 9 RuleTester uses global `describe`/`it`/`afterAll`, which vitest
// provides (globals: true). It requires FLAT `languageOptions`, not the legacy
// `parserOptions`.
const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-raw-maximize-api", rule, {
  valid: [
    // The correct shim call sites must NOT trigger, even though `maximize` /
    // `unmaximize` collide with the raw Meta.Window method names.
    { code: "Compat.maximize(win);", filename: "lib/extension/window.js" },
    { code: "Compat.unmaximize(win);", filename: "lib/extension/window.js" },
    { code: "if (Compat.isMaximized(win)) doThing();", filename: "lib/extension/window.js" },
    { code: "const f = Compat.getMaximizeFlags(win);", filename: "lib/extension/window.js" },
    // compat.js itself is exempt: it owns the raw APIs.
    { code: "win.is_maximized();", filename: "lib/extension/compat.js" },
    { code: "win.maximize(flags);", filename: "lib/extension/compat.js" },
    { code: "win.set_maximize_flags(flags); win.maximize();", filename: "lib/extension/compat.js" },
    // Unrelated members are untouched.
    { code: "win.get_frame_rect();", filename: "lib/extension/window.js" },
  ],
  invalid: [
    {
      code: "win.is_maximized();",
      filename: "lib/extension/window.js",
      errors: [{ messageId: "rawSnake" }],
    },
    {
      code: "win.get_maximized();",
      filename: "lib/extension/window.js",
      errors: [{ messageId: "rawSnake" }],
    },
    {
      code: "win.set_maximize_flags(flags);",
      filename: "lib/extension/window.js",
      errors: [{ messageId: "rawSnake" }],
    },
    {
      code: "win.set_unmaximize_flags(flags);",
      filename: "lib/extension/window.js",
      errors: [{ messageId: "rawSnake" }],
    },
    {
      code: "win.get_maximize_flags();",
      filename: "lib/extension/window.js",
      errors: [{ messageId: "rawSnake" }],
    },
    {
      // Raw receiver (not Compat) calling the colliding name.
      code: "win.maximize(flags);",
      filename: "lib/extension/window.js",
      errors: [{ messageId: "rawMaximize" }],
    },
    {
      code: "metaWindow.unmaximize();",
      filename: "lib/extension/window.js",
      errors: [{ messageId: "rawMaximize" }],
    },
  ],
});
