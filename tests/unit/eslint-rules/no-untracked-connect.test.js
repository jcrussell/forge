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
    // connectObject is the auto-tracked idiom and must NOT fire when it names an owner.
    "foo.connectObject('x', cb, this);",
    "foo.connectObject('x', cb, 'y', () => {}, this._backdrop);",
    "foo.connectObject('x', cb, GObject.ConnectFlags.AFTER, this);",
    "foo.connectObject('x', cb, 0, 'y', cb, owner);",
    "foo.connectObject(...args);",
    "foo.connectObject('x', cb, GObject.ConnectFlags.AFTER | GObject.ConnectFlags.SWAPPED, this);",
    // A variable in the flags slot followed by more arguments is ambiguous: not flagged.
    "foo.connectObject('x', cb, flags, this);",
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
      // No owner: tracked under globalThis, never cleaned up.
      code: "foo.connectObject('x', cb);",
      errors: [{ messageId: "ownerless" }],
    },
    {
      code: "foo.connectObject('x', cb, 'y', cb);",
      errors: [{ messageId: "ownerless" }],
    },
    {
      // A trailing handler or flags is not an owner.
      code: "foo.connectObject('x', cb, 'y', () => {});",
      errors: [{ messageId: "ownerless" }],
    },
    {
      code: "foo.connectObject('x', cb, 1);",
      errors: [{ messageId: "ownerless" }],
    },
    {
      code: "foo.connectObject('x', cb, GObject.ConnectFlags.AFTER);",
      errors: [{ messageId: "ownerless" }],
    },
    {
      code: "foo.connectObject('x', cb, GObject.ConnectFlags.AFTER | 1);",
      errors: [{ messageId: "ownerless" }],
    },
    {
      // signalTracker resolves a null or undefined owner to globalThis.
      code: "foo.connectObject('x', cb, null);",
      errors: [{ messageId: "ownerless" }],
    },
    {
      code: "foo.connectObject('x', cb, 0, undefined);",
      errors: [{ messageId: "ownerless" }],
    },
    {
      // Flagged wherever the call sits, not only as a statement.
      code: "const r = foo.connectObject('x', function () {});",
      errors: [{ messageId: "ownerless" }],
    },
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
