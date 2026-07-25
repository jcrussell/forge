import { RuleTester } from "eslint";
import rule from "../../../eslint-rules/no-untracked-connect.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-untracked-connect", rule, {
  valid: [
    // Tracked idioms: the returned id is captured / used somewhere.
    "const id = foo.connect('x', cb);",
    "this._id = foo.connect('x', cb);",
    "x = foo.connect('x', cb);",
    "arr.push(foo.connect('x', cb));",
    "const ids = [foo.connect('x', cb), bar.connect('y', cb)];",
    "function f() { return foo.connect('x', cb); }",
    // connectObject is the auto-tracked idiom and must NOT fire.
    "foo.connectObject('x', cb, this);",
    // Self-connect: a GObject's own handlers are freed with the instance, so it
    // can never outlive its owner — not the leak class.
    "this.connect('toggled', cb);",
    "this.connect('destroy', () => {});",
    // Non-connect statements.
    "foo.disconnect(id);",
    "foo.emit('x');",
  ],
  invalid: [
    {
      code: "foo.connect('x', cb);",
      errors: [{ messageId: "untracked" }],
    },
    {
      code: "this._settings.connect('changed::gap', () => {});",
      errors: [{ messageId: "untracked" }],
    },
    {
      code: "obj.a.b.connect('x', cb);",
      errors: [{ messageId: "untracked" }],
    },
  ],
});
