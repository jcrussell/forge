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
 *
 * It also flags a `.minimized` read on a tree node's window wrapper,
 * `X.nodeValue.minimized` or `X._data.minimized`, unless it is guarded by
 * `Utils.isWindowAlive(<receiver>)` (receivers compared by source text, with
 * `?.` read as `.`). A finalized Meta.Window throws on any property read
 * (hazards.md §2). Walking up to the enclosing function, the read is guarded
 * when it is:
 *   - on the right of a `&&` whose left chain contains isWindowAlive(X)
 *   - on the right of a `||` whose left chain contains !isWindowAlive(X)
 *   - in the consequent of `if (isWindowAlive(X) ...)` or `isWindowAlive(X) ? ... : ...`
 *   - after an earlier sibling `if (... || !isWindowAlive(X)) return/continue/
 *     break/throw` in an enclosing block
 * A truthiness check (`X.nodeValue && X.nodeValue.minimized`) is not a guard: a
 * finalized wrapper is truthy. The rule cannot see a read through a captured
 * local (`const w = node.nodeValue; ... w.minimized`) or a bare
 * `metaWindow.minimized`; those stay out of scope. Known limits: it trusts a
 * guard across an `await` (the window can die while suspended) and across a
 * reassignment of the receiver between the guard and the read.
 */

"use strict";

const GUARDED_METHODS = new Set(["get_workspace", "get_monitor"]);
const WRAPPER_PROPS = new Set(["nodeValue", "_data"]);
const EXIT_TYPES = new Set([
  "ReturnStatement",
  "ContinueStatement",
  "BreakStatement",
  "ThrowStatement",
]);
const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

// Source text of a receiver with optional chaining dropped, so a guard on
// `n.nodeValue` covers a read of `n?.nodeValue.minimized` and vice versa.
function receiverText(node, sourceCode) {
  return sourceCode
    .getText(node)
    .replace(/\?\.(?=[[(])/g, "")
    .replace(/\?\./g, ".");
}

function isAliveCall(node, receiver, sourceCode) {
  if (!node || node.type !== "CallExpression" || node.arguments.length < 1) return false;
  const callee = node.callee;
  const name =
    callee.type === "Identifier"
      ? callee.name
      : callee.type === "MemberExpression" && !callee.computed
      ? callee.property.name
      : null;
  return name === "isWindowAlive" && receiverText(node.arguments[0], sourceCode) === receiver;
}

function isNegatedAliveCall(node, receiver, sourceCode) {
  return (
    node.type === "UnaryExpression" &&
    node.operator === "!" &&
    isAliveCall(node.argument, receiver, sourceCode)
  );
}

// Operands of a left-associative `a OP b OP c` chain.
function flatten(node, operator) {
  if (node.type === "LogicalExpression" && node.operator === operator) {
    return [...flatten(node.left, operator), ...flatten(node.right, operator)];
  }
  return [node];
}

function exitsOnDeadWindow(stmt, receiver, sourceCode) {
  if (
    stmt.type !== "IfStatement" ||
    !flatten(stmt.test, "||").some((n) => isNegatedAliveCall(n, receiver, sourceCode))
  ) {
    return false;
  }
  let exit = stmt.consequent;
  if (exit.type === "BlockStatement") exit = exit.body[exit.body.length - 1];
  return !!exit && EXIT_TYPES.has(exit.type);
}

function isGuarded(node, receiver, sourceCode) {
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (FUNCTION_TYPES.has(parent.type)) return false;
    if (parent.type === "LogicalExpression" && parent.right === child) {
      const left = flatten(parent.left, parent.operator);
      if (parent.operator === "&&" && left.some((n) => isAliveCall(n, receiver, sourceCode))) {
        return true;
      }
      if (
        parent.operator === "||" &&
        left.some((n) => isNegatedAliveCall(n, receiver, sourceCode))
      ) {
        return true;
      }
    }
    if (
      (parent.type === "IfStatement" || parent.type === "ConditionalExpression") &&
      parent.consequent === child &&
      flatten(parent.test, "&&").some((n) => isAliveCall(n, receiver, sourceCode))
    ) {
      return true;
    }
    if (parent.type === "BlockStatement") {
      const earlier = parent.body.slice(0, parent.body.indexOf(child));
      if (earlier.some((s) => exitsOnDeadWindow(s, receiver, sourceCode))) return true;
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when the nullable return of .get_workspace()/.get_monitor() is immediately dereferenced (chained), or when a node's window wrapper is read for .minimized without a Utils.isWindowAlive guard.",
    },
    schema: [],
    messages: {
      unguarded:
        "`.{{name}}()` can return null on an unmanaged window and is dereferenced immediately here; capture it first and guard (Utils.isWindowAlive / a null check) before accessing members.",
      unguardedMinimized:
        "`{{receiver}}.minimized` throws on a finalized Meta.Window; guard it with Utils.isWindowAlive({{receiver}}) first.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== "Identifier") return;
        if (node.property.name !== "minimized") return;
        const object = node.object;
        if (object.type !== "MemberExpression" || object.computed) return;
        if (object.property.type !== "Identifier" || !WRAPPER_PROPS.has(object.property.name)) {
          return;
        }
        const receiver = receiverText(object, sourceCode);
        if (isGuarded(node, receiver, sourceCode)) return;
        context.report({
          node: node.property,
          messageId: "unguardedMinimized",
          data: { receiver },
        });
      },
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
