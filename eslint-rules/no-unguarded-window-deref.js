/*
 * Repo-local ESLint rule (forge-fhen.6): no-unguarded-window-deref
 *
 * WARNS when the possibly-null RETURN VALUE of `.get_workspace()` /
 * `.get_monitor()` is dereferenced IMMEDIATELY (chained), e.g.
 *   win.get_workspace().index()
 *   mw.get_monitor().foo
 *   win.get_workspace()[i]
 * On a Meta.Window that has already been unmanaged these return null, so an
 * immediate member access on the result throws on the spot — a recurring crash
 * class in GNOME extensions ("window died between the signal and the handler").
 *
 * NARROW SEMANTICS — this rule fires ONLY when the get_workspace/get_monitor
 * CallExpression is itself the `object` of an enclosing MemberExpression
 * (including optional-chaining member parents). That is the actual "dereference
 * without an intervening guard" pattern. It deliberately does NOT fire when the
 * result is:
 *   - assigned / declared        const ws = win.get_workspace();  (guard follows)
 *   - a standalone call          win.get_workspace();
 *   - a comparison operand       win.get_workspace() === null / mw.get_monitor() < 0
 *   - a logical/conditional/arg  operand, !x, cond ? ... , f(win.get_workspace())
 * ...because in all of those the null return is checked before use, so flagging
 * them is pure noise. Severity is `error` (forge-fhen.12): a blocking gate, once
 * the last raw-chain site (command.js PrefsOpen) was fixed to capture-then-guard.
 */

"use strict";

const GUARDED_METHODS = new Set(["get_workspace", "get_monitor"]);

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when the nullable return of .get_workspace()/.get_monitor() is immediately dereferenced (chained). On an unmanaged Meta.Window these return null; capture the result and guard before use.",
    },
    schema: [],
    messages: {
      unguarded:
        "`.{{name}}()` can return null on an unmanaged window and is dereferenced immediately here; capture it first and guard (Utils.isWindowAlive / a null check) before accessing members.",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        if (callee.computed || callee.property.type !== "Identifier") return;
        const name = callee.property.name;
        if (!GUARDED_METHODS.has(name)) return;

        // Only fire when the call's RESULT is the object of an enclosing member
        // access (plain or optional-chained) — i.e. the null return is derefed
        // on the spot: get_workspace().foo / get_monitor()[i]. Everything else
        // (assignment, comparison, argument, standalone call) checks the null
        // before use and is intentionally left alone.
        const parent = node.parent;
        if (parent && parent.type === "MemberExpression" && parent.object === node) {
          context.report({ node: callee.property, messageId: "unguarded", data: { name } });
        }
      },
    };
  },
};
