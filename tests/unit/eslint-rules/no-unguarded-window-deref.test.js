import { RuleTester } from "eslint";
import rule from "../../../eslint-rules/no-unguarded-window-deref.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-unguarded-window-deref", rule, {
  valid: [
    // Unrelated methods are untouched.
    "win.get_frame_rect().width;",
    "win.get_title();",
    // Captured result — the guard comes next.
    "function f() { const ws = win.get_workspace(); if (!ws) return; }",
    // Comparison operands — the null is checked, not dereferenced.
    "function f() { if (win.get_workspace() === null) return; }",
    "function f() { if (mw.get_monitor() < 0) return null; }",
    // Standalone call — no immediate member access on the result.
    "win.get_workspace();",
    // Argument / logical operands — result is not derefed on the spot.
    "doThing(win.get_workspace());",
    "const x = win.get_workspace() || fallback;",
  ],
  invalid: [
    {
      // Chained deref of the nullable return.
      code: "win.get_workspace().index();",
      errors: [{ messageId: "unguarded" }],
    },
    {
      code: "mw.get_monitor().foo;",
      errors: [{ messageId: "unguarded" }],
    },
    {
      // Computed member access on the result also throws on null.
      code: "win.get_workspace()[i];",
      errors: [{ messageId: "unguarded" }],
    },
  ],
});
