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
    // .minimized behind an isWindowAlive guard on the same receiver.
    "const m = Utils.isWindowAlive(w.nodeValue) && !w.nodeValue.minimized;",
    // Guard mid-chain: the read sits right of a && chain containing it.
    "const t = w.isTile() && Utils.isWindowAlive(w.nodeValue) && !w.nodeValue.minimized && ok;",
    // Negated guard on the left of ||.
    "const skip = !Utils.isWindowAlive(n.nodeValue) || n.nodeValue.minimized;",
    // In the consequent of if (isWindowAlive(...)).
    "if (Utils.isWindowAlive(n.nodeValue)) { use(n.nodeValue.minimized); }",
    // Early return in an enclosing block, read nested deeper (getTiledChildren shape).
    `function f(node) {
      if (node.isWindow()) {
        if (!Utils.isWindowAlive(node.nodeValue)) return false;
        if (!node.nodeValue.minimized) return true;
      }
    }`,
    "function f(n) { for (;;) { if (!Utils.isWindowAlive(n.nodeValue)) continue; use(n.nodeValue.minimized); } }",
    // Early exit on a || test that includes the negated guard.
    "function f(node) { if (!node || !Utils.isWindowAlive(node.nodeValue)) return false; return node.nodeValue.minimized; }",
    // Ternary consequent.
    "const m = Utils.isWindowAlive(n.nodeValue) ? n.nodeValue.minimized : false;",
    // Early exits by throw and break.
    "function f(n) { if (!Utils.isWindowAlive(n.nodeValue)) throw new Error('dead'); return n.nodeValue.minimized; }",
    "function f(n) { for (;;) { if (!Utils.isWindowAlive(n.nodeValue)) break; use(n.nodeValue.minimized); } }",
    // Optional chaining on either side compares as a plain member access.
    "function f(node) { if (!Utils.isWindowAlive(node.nodeValue)) return; return node?.nodeValue.minimized; }",
    "const m = Utils.isWindowAlive(node?.nodeValue) && node.nodeValue.minimized;",
    // _data receiver (window.js uses the raw field).
    "const m = n._type === 1 && Utils.isWindowAlive(n._data) && n._data.minimized;",
    // Out of scope: a bare window or a captured local.
    "const m = metaWindow.minimized;",
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
    {
      // A truthiness check is not a guard: a finalized wrapper is truthy.
      code: "const m = n.nodeValue && n.nodeValue.minimized;",
      errors: [{ messageId: "unguardedMinimized" }],
    },
    {
      code: "const m = !w.nodeValue.minimized;",
      errors: [{ messageId: "unguardedMinimized" }],
    },
    {
      // The guard probes a different receiver.
      code: "const m = Utils.isWindowAlive(a.nodeValue) && b.nodeValue.minimized;",
      errors: [{ messageId: "unguardedMinimized" }],
    },
    {
      // Wrong polarity: the right of || runs only when the window is dead.
      code: "const m = Utils.isWindowAlive(n.nodeValue) || n.nodeValue.minimized;",
      errors: [{ messageId: "unguardedMinimized" }],
    },
    {
      // The ternary's alternate runs when the window is dead.
      code: "const m = Utils.isWindowAlive(n.nodeValue) ? false : n.nodeValue.minimized;",
      errors: [{ messageId: "unguardedMinimized" }],
    },
    {
      // An early exit on a && test does not run for every dead window.
      code: "function f(n) { if (ok && !Utils.isWindowAlive(n.nodeValue)) return; return n.nodeValue.minimized; }",
      errors: [{ messageId: "unguardedMinimized" }],
    },
    {
      // A guard in an enclosing function's block does not cover a callback.
      code: `function f(n) {
        if (!Utils.isWindowAlive(n.nodeValue)) return;
        later(() => n.nodeValue.minimized);
      }`,
      errors: [{ messageId: "unguardedMinimized" }],
    },
  ],
});
