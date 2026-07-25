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
 *   - `this.connect(...)` (a SELF-connect, receiver is `ThisExpression`) is NOT
 *     matched: a GObject's own handlers are freed when the object itself is
 *     finalized, so a self-connect can never outlive its owner — it is not the
 *     leak class. Note `this._settings.connect(...)` (receiver is a
 *     MemberExpression, i.e. an EXTERNAL object stored on `this`) still fires.
 *
 * Severity is `error` (forge-fhen.12): a blocking gate. Genuinely intentional
 * fire-and-forget connects are actor-lifetime-bound (destroyed actors
 * auto-disconnect) and carry a scoped `eslint-disable` with the reason at the
 * site. Prefs sources are exempted by file scope in eslint.config.js (the prefs
 * process is torn down wholesale on window close).
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
        // `this.connect(...)` is a self-connect — freed with the instance, never a
        // leak. `this._x.connect(...)` (MemberExpression receiver) still fires.
        if (callee.object.type === "ThisExpression") return;
        context.report({ node: callee.property, messageId: "untracked" });
      },
    };
  },
};
