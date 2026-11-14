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
 *   - `.connectObject(...)` is the auto-tracked idiom (GNOME's
 *     connectObject/disconnectObject bookkeeping) and needs no id, but it must
 *     name an owner as its last argument: `disconnectObject(owner)` and an
 *     actor owner's `destroy` are what free the handlers. Without one,
 *     signalTracker.js tracks the handlers under globalThis, which is never
 *     destroyed, so they leak exactly like a discarded id. A call is ownerless
 *     when, after its signal/handler pairs (each optionally followed by numeric
 *     flags), no argument is left, or the last one is a function, a number, or
 *     a literal null/undefined (signalTracker resolves those to globalThis too).
 *     Flags are a number, a GObject.ConnectFlags member, or a `|` of those. A
 *     variable in the flags slot followed by more arguments can be flags or
 *     the next signal name; the rule can't tell, so it doesn't flag the call
 *     rather than risk a false positive.
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

const isFunction = (n) => n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression";
const isNumber = (n) => n.type === "Literal" && typeof n.value === "number";
const isNullish = (n) =>
  (n.type === "Literal" && n.value === null) ||
  (n.type === "Identifier" && n.name === "undefined") ||
  (n.type === "UnaryExpression" && n.operator === "void");
// Flags are a number: a literal, a GObject.ConnectFlags member, or a `|` of those.
const isFlags = (n) =>
  isNumber(n) ||
  (n.type === "MemberExpression" &&
    n.object.type === "MemberExpression" &&
    !n.object.computed &&
    n.object.property.name === "ConnectFlags") ||
  (n.type === "BinaryExpression" && n.operator === "|" && isFlags(n.left) && isFlags(n.right));
// A non-literal, non-function argument whose value only runtime knows.
const isOpaque = (n) => n.type !== "Literal" && n.type !== "TemplateLiteral" && !isFunction(n);

// Parse the arguments the way signalTracker.js does: (signal, handler, [flags])
// pairs, then an optional owner.
function hasOwner(args) {
  if (args.some((a) => a.type === "SpreadElement")) return true; // can't tell
  let i = 0;
  while (args.length - i > 1) {
    const third = args[i + 2];
    if (third && isFlags(third)) i += 3;
    else if (third && args.length - i > 3 && isOpaque(third)) return true; // flags or signal
    else i += 2;
  }
  const owner = args[i];
  return !!owner && !isFunction(owner) && !isNumber(owner) && !isNullish(owner);
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Warn when a .connect() handler id is discarded (untracked signal handler — cannot be disconnected in disable()).",
    },
    schema: [],
    messages: {
      ownerless:
        "`.connectObject(...)` without an owner tracks the handlers under globalThis, which is never cleaned up; pass the owner (`this`, or the actor whose lifetime bounds them) as the last argument.",
      untracked:
        "The id returned by `.connect(...)` is discarded; store it (or use connectObject) so the handler can be disconnected in disable().",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        if (callee.computed || callee.property.type !== "Identifier") return;
        if (callee.property.name !== "connectObject") return;
        if (!hasOwner(node.arguments)) {
          context.report({ node: callee.property, messageId: "ownerless" });
        }
      },
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
