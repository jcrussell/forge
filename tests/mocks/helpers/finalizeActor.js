/**
 * Model a finalized GJS St actor (St.BoxLayout tab/decoration, etc.) in tests.
 *
 * Real GJS throws "Object <Type> has been already deallocated" on EVERY method
 * call once the underlying actor is finalized — after destroy()/destroy_all_children(),
 * a reparent-detach, or a container flatten. Production must reset the stale
 * reference (node.tab / node.decoration) before touching such an actor.
 *
 * Tests used to fake this ad hoc:
 *
 *   tab.destroy = () => { tab._dead = true; };
 *   tab.get_child_at_index = (i) =>
 *     { if (tab._dead) throw new Error("...already deallocated"); return real(i); };
 *
 * which under-models a truly dead actor: only the ONE accessor the author
 * remembered threw, so a production path that touched a *different* method slipped
 * through green. This helper replaces that pattern faithfully — after
 * finalizeActor(actor), ANY method call throws, exactly like the real actor.
 *
 * The St lifecycle is deferred (the actor is live until destroyed), so the common
 * usage is to arm destroy() to finalize:
 *
 *   tab.destroy = () => finalizeActor(tab);
 *
 * See the mock-fidelity overhaul (bd forge-fhen.4).
 */

const finalizedActorError = (type) => `${type} has been already deallocated`;

export const FINALIZED_ACTOR_ERROR = finalizedActorError("St.BoxLayout");

/**
 * Turn a live mock St actor into a finalized one: every method (accessors, signal
 * methods, mutators) throws "<type> has been already deallocated". Mutates and
 * returns `actor`. Finalization is one-way.
 *
 * @param {object} actor - a live mock actor (e.g. an St.BoxLayout tab)
 * @param {string} [type="St.BoxLayout"] - the GObject type name for the error string
 * @returns {object} the same actor, now finalized
 */
export function finalizeActor(actor, type = "St.BoxLayout") {
  const boom = () => {
    throw new Error(finalizedActorError(type));
  };

  // Replace every function-valued property across the instance and its prototype
  // chain (down to, but excluding, Object.prototype) with the thrower. Definitions
  // land on the instance so the shared prototype is never mutated.
  const patched = new Set();
  for (let obj = actor; obj && obj !== Object.prototype; obj = Object.getPrototypeOf(obj)) {
    for (const name of Object.getOwnPropertyNames(obj)) {
      if (name === "constructor" || patched.has(name)) continue;
      const desc = Object.getOwnPropertyDescriptor(obj, name);
      if (desc && typeof desc.value === "function" && desc.configurable !== false) {
        Object.defineProperty(actor, name, { value: boom, configurable: true, writable: true });
        patched.add(name);
      }
    }
  }

  actor.__finalized = true;
  return actor;
}

export default { finalizeActor, FINALIZED_ACTOR_ERROR };
