/*
 * Repo-local ESLint rule: no-raw-window-activation
 *
 * Bans raw Meta.Window raise()/focus(time)/activate(time) calls in
 * lib/extension EXCEPT lib/extension/utils.js, which owns the guarded wrappers
 * (Utils.safeRaise / safeFocus / safeActivate). The tree can still hold a window
 * Mutter has already unmanaged (between "unmanaged" and the actor's "destroy");
 * its wrapper is alive, so Utils.isWindowAlive() passes, but raise()/focus()/
 * activate() on it fail Mutter assertions (forge-ext/forge#524). The wrappers
 * check Utils.isWindowManaged() first.
 *
 * No type inference: the window API takes at most one argument (a timestamp),
 * so calls with two or more arguments, such as Tree.focus(node, direction), are
 * not reported.
 */

"use strict";

const METHODS = new Set(["raise", "focus", "activate"]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban raw Meta.Window raise/focus/activate; use Utils.safeRaise/safeFocus/safeActivate.",
    },
    schema: [],
    messages: {
      rawActivation:
        "Raw `.{{name}}()` on a window can hit an unmanaged Meta.Window; use Utils.safe{{Name}}() instead.",
    },
  },
  create(context) {
    const filename =
      (typeof context.filename === "string" && context.filename) ||
      (typeof context.getFilename === "function" && context.getFilename()) ||
      "";
    const normalized = filename.replace(/\\/g, "/");
    // Meta.Window only lives in the shell process; prefs (GTK) has its own
    // activate()s. utils.js owns the wrappers.
    if (!normalized.includes("lib/extension/")) return {};
    if (normalized.endsWith("lib/extension/utils.js")) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier") return;
        const name = callee.property.name;
        if (!METHODS.has(name) || node.arguments.length > 1) return;
        context.report({
          node: callee.property,
          messageId: "rawActivation",
          data: { name, Name: name[0].toUpperCase() + name.slice(1) },
        });
      },
    };
  },
};
