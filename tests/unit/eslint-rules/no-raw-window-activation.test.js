import { RuleTester } from "eslint";
import rule from "../../../eslint-rules/no-raw-window-activation.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-raw-window-activation", rule, {
  valid: [
    { code: "Utils.safeRaise(win);", filename: "lib/extension/window.js" },
    {
      code: "Utils.safeFocus(win, t); Utils.safeActivate(win, t);",
      filename: "lib/extension/tree.js",
    },
    // utils.js owns the wrappers
    { code: "win.raise(); win.focus(t); win.activate(t);", filename: "lib/extension/utils.js" },
    // Prefs (GTK) has its own activate()
    { code: "row.activate();", filename: "lib/prefs/keyboard.js" },
    // Tree.focus(node, direction) is not the window API
    { code: "this.focus(next, direction);", filename: "lib/extension/tree.js" },
    { code: "wm.tree.focus(node, dir);", filename: "lib/extension/command.js" },
  ],
  invalid: [
    {
      code: "win.raise();",
      filename: "lib/extension/window.js",
      errors: [{ messageId: "rawActivation" }],
    },
    {
      code: "metaWindow.focus(global.get_current_time());",
      filename: "lib/extension/focus.js",
      errors: [{ messageId: "rawActivation" }],
    },
    {
      code: "node.nodeValue.activate(time);",
      filename: "lib/extension/command.js",
      errors: [{ messageId: "rawActivation" }],
    },
    {
      code: "w.nodeValue?.raise();",
      filename: "lib/extension/tree.js",
      errors: [{ messageId: "rawActivation" }],
    },
  ],
});
