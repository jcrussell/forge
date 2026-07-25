/*
 * Repo-local ESLint rule (forge-fhen.6): no-untracked-connect
 *
 * WARNS when a GObject `.connect(...)` call's return value (the handler id) is
 * DISCARDED. An untracked handler id cannot be disconnected in disable(), which
 * is the classic GNOME-extension leak: signal handlers outliving the object and
 * firing after teardown.
 *
 * Heuristic (deliberately structural, not data-flow):
 *   - The offending shape is a CallExpression whose callee is a MemberExpression
 *     with property name `connect`, sitting DIRECTLY as the expression of an
 *     ExpressionStatement. In that position the returned id is unused.
 *   - Tracked idioms are NOT this shape and therefore do not fire:
 *       x = foo.connect(...)          (AssignmentExpression)
 *       const id = foo.connect(...)   (VariableDeclarator)
 *       arr.push(foo.connect(...))    (argument of a call)
 *       [ foo.connect(...) ]          (array element)
 *       return foo.connect(...)       (ReturnStatement)
 *     ...because in each the connect CallExpression is a child of another node,
 *     not the statement's top-level expression.
 *   - `.connectObject(...)` is intentionally NOT matched: it is the auto-tracked
 *     idiom (GNOME's connectObject/disconnectObject bookkeeping) and needs no id.
 *
 * Severity is `warn`: fire-and-forget connects exist intentionally in a few
 * places (tree.js, prefs), so this is an advisory nudge, not a hard gate.
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Warn when a .connect() handler id is discarded (untracked signal handler — cannot be disconnected in disable()).",
    },
    schema: [],
    messages: {
      untracked:
        "The id returned by `.connect(...)` is discarded; store it (or use connectObject) so the handler can be disconnected in disable().",
    },
  },

  create(context) {
    return {
      // Match only when the connect() call is the whole statement expression.
      "ExpressionStatement > CallExpression.expression"(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        if (callee.computed || callee.property.type !== "Identifier") return;
        if (callee.property.name !== "connect") return; // NOT connectObject
        context.report({ node: callee.property, messageId: "untracked" });
      },
    };
  },
};
