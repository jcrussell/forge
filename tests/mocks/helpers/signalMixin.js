/**
 * Signal mixin for mock objects
 *
 * Provides a reusable signal system (connect, disconnect, emit) that can be
 * applied to any mock object. This extracts the common pattern from Meta.js,
 * Gio.js, St.js, and Clutter.js mocks.
 *
 * It also provides GNOME Shell's connectObject/disconnectObject, modelled on
 * js/misc/signalTracker.js. In the shell these exist on every GObject and on
 * the JS EventEmitters (Main.overview, Main.layoutManager, Main.sessionMode);
 * the prefs process has neither. Handler ids are tracked per (emitter, owner)
 * in a module-wide map that holds both strongly. Only an actor's `destroy`
 * signal, on the emitter or on the owner, untracks automatically; nothing is
 * untracked on finalization. Untracking calls the emitter's own disconnect(),
 * so disconnectObject on a finalized window throws, as in the shell.
 */

// Emitter -> { owners: Map(owner -> { ids, destroyId }), destroyId }.
const trackers = new Map();

function hasDestroySignal(obj) {
  return obj?._hasDestroySignal === true;
}

function trackerFor(emitter) {
  let tracker = trackers.get(emitter);
  if (!tracker) {
    tracker = { owners: new Map(), destroyId: 0 };
    trackers.set(emitter, tracker);
    // An actor emitter drops every owner's handlers when it is destroyed.
    if (hasDestroySignal(emitter)) {
      tracker.destroyId = emitter.connect("destroy", () => {
        for (const owner of [...tracker.owners.keys()]) untrack(emitter, owner);
      });
    }
  }
  return tracker;
}

function untrack(emitter, owner) {
  const tracker = trackers.get(emitter);
  const data = tracker?.owners.get(owner);
  if (!data) return;
  tracker.owners.delete(owner);
  for (const id of data.ids) emitter.disconnect(id);
  if (data.destroyId) owner.disconnect(data.destroyId);
  if (tracker.owners.size === 0) {
    if (tracker.destroyId) emitter.disconnect(tracker.destroyId);
    trackers.delete(emitter);
  }
}

/**
 * connectObject(signal, handler, [flags], ..., [owner]): connect each
 * signal/handler pair and track the ids under `owner`. A missing owner (an
 * even argument count, or a function or number last) defaults to globalThis,
 * which is never destroyed.
 */
function connectObject(...args) {
  const ids = [];
  while (args.length > 1) {
    const [signal, handler, flags] = args;
    args = args.slice(typeof flags === "number" ? 3 : 2);
    ids.push(this.connect(signal, handler));
  }
  const owner = args[0] ?? globalThis;
  const tracker = trackerFor(this);
  let data = tracker.owners.get(owner);
  if (!data) {
    data = { ids: [], destroyId: 0 };
    tracker.owners.set(owner, data);
    // An actor owner drops its handlers on this emitter when it is destroyed.
    if (hasDestroySignal(owner)) {
      data.destroyId = owner.connect("destroy", () => untrack(this, owner));
    }
  }
  data.ids.push(...ids);
}

function disconnectObject(owner) {
  untrack(this, owner);
}

/**
 * Create a class mixin that adds signal support
 * Use: class MyClass extends withSignals(BaseClass) { }
 * @param {Function} Base - Base class to extend
 * @param {Object} [options]
 * @param {boolean} [options.destroySignal=false] - the class is an actor:
 *   its destroy() emits `destroy`, which connectObject tracking listens for
 * @returns {Function} Extended class with signal support
 */
export function withSignals(Base = class {}, { destroySignal = false } = {}) {
  return class extends Base {
    constructor(...args) {
      super(...args);
      this._signals = {};
    }

    get _hasDestroySignal() {
      return destroySignal;
    }

    connect(signal, callback) {
      if (!this._signals[signal]) this._signals[signal] = [];
      const id = Math.random();
      this._signals[signal].push({ id, callback });
      return id;
    }

    disconnect(id) {
      for (const signal in this._signals) {
        this._signals[signal] = this._signals[signal].filter((s) => s.id !== id);
      }
    }

    emit(signal, ...args) {
      if (this._signals[signal]) {
        this._signals[signal].forEach((s) => s.callback(...args));
      }
    }

    hasHandlers(signal) {
      return this._signals[signal]?.length > 0;
    }

    getHandlerCount(signal) {
      return this._signals[signal]?.length ?? 0;
    }

    connectObject(...args) {
      return connectObject.call(this, ...args);
    }

    disconnectObject(owner) {
      return disconnectObject.call(this, owner);
    }
  };
}

/**
 * Graft the signal system onto a plain mock object (for object-literal mocks
 * like the global display/workspace_manager that have no class to extend).
 * @param {Object} obj - Mock object to augment in place
 * @returns {Object} The same object with connect/disconnect/emit support
 */
export { connectObject, disconnectObject };

const SignalBox = withSignals();
export function addSignalSupport(obj) {
  obj._signals = {};
  for (const method of [
    "connect",
    "disconnect",
    "emit",
    "hasHandlers",
    "getHandlerCount",
    "connectObject",
    "disconnectObject",
  ]) {
    obj[method] = SignalBox.prototype[method];
  }
  return obj;
}

export default {
  withSignals,
  addSignalSupport,
  connectObject,
  disconnectObject,
};
