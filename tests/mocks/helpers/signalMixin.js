/**
 * Signal mixin for mock objects
 *
 * Provides a reusable signal system (connect, disconnect, emit) that can be
 * applied to any mock object. This extracts the common pattern from Meta.js,
 * Gio.js, St.js, and Clutter.js mocks.
 */

/**
 * Create a class mixin that adds signal support
 * Use: class MyClass extends withSignals(BaseClass) { }
 * @param {Function} Base - Base class to extend
 * @returns {Function} Extended class with signal support
 */
export function withSignals(Base = class {}) {
  return class extends Base {
    constructor(...args) {
      super(...args);
      this._signals = {};
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
  };
}

/**
 * Graft the signal system onto a plain mock object (for object-literal mocks
 * like the global display/workspace_manager that have no class to extend).
 * @param {Object} obj - Mock object to augment in place
 * @returns {Object} The same object with connect/disconnect/emit support
 */
const SignalBox = withSignals();
export function addSignalSupport(obj) {
  obj._signals = {};
  for (const method of ["connect", "disconnect", "emit", "hasHandlers", "getHandlerCount"]) {
    obj[method] = SignalBox.prototype[method];
  }
  return obj;
}

export default {
  withSignals,
  addSignalSupport,
};
