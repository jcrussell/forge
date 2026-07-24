/**
 * Model a finalized GJS Meta.Window wrapper in tests.
 *
 * Real GJS throws "Object <Type> has been already deallocated" on EVERY method
 * call and property read once the underlying GObject is finalized — a fast or
 * Wayland close, a sleep/resume race, etc. Production must probe
 * Utils.isWindowAlive() (or a structural check like the node's parentNode)
 * before touching such a wrapper.
 *
 * Tests used to fake this ad hoc:
 *
 *   const boom = () => { throw new Error("...already deallocated"); };
 *   dead.get_id = boom;          // <- only the ONE accessor the author remembered
 *
 * which under-models a truly dead wrapper: the "finalized" window still answered
 * every other method, so a production path that dereferenced a *different*
 * accessor slipped through green. This helper replaces that pattern faithfully —
 * after finalizeWindow(win), ANY method call or hot field read throws, exactly
 * like the real wrapper. See the mock-fidelity overhaul (bd forge-fhen.4).
 */

export const FINALIZED_WINDOW_ERROR = "Object .Meta.Window has been already deallocated";

/**
 * Turn a live mock Meta.Window into a finalized one: every method (accessors,
 * signal methods, mutators) and the hot directly-read fields throw
 * "already deallocated". Mutates and returns `win`. Set up the window's place in
 * the tree/workspace/fixtures BEFORE calling this — finalization is one-way.
 *
 * @param {object} win - a live mock window (e.g. from createMockWindow)
 * @returns {object} the same window, now finalized
 */
export function finalizeWindow(win) {
  const boom = () => {
    throw new Error(FINALIZED_WINDOW_ERROR);
  };

  // Replace every function-valued property across the instance and its prototype
  // chain (down to, but excluding, Object.prototype) with the thrower. Definitions
  // land on the instance so the shared prototype is never mutated.
  const patched = new Set();
  for (let obj = win; obj && obj !== Object.prototype; obj = Object.getPrototypeOf(obj)) {
    for (const name of Object.getOwnPropertyNames(obj)) {
      if (name === "constructor" || patched.has(name)) continue;
      const desc = Object.getOwnPropertyDescriptor(obj, name);
      if (desc && typeof desc.value === "function" && desc.configurable !== false) {
        Object.defineProperty(win, name, { value: boom, configurable: true, writable: true });
        patched.add(name);
      }
    }
  }

  // Fields production reads directly (not through an accessor) throw on read too
  // — a real finalized wrapper throws on ANY property access, not just methods.
  const deadFields = [
    "title",
    "wm_class",
    "minimized",
    "fullscreen",
    "above",
    "maximized_horizontally",
    "maximized_vertically",
  ];
  for (const field of deadFields) {
    Object.defineProperty(win, field, { configurable: true, get: boom });
  }

  win.__finalized = true;
  return win;
}

export default { finalizeWindow, FINALIZED_WINDOW_ERROR };
