/**
 * Signal mixin for mock objects
 *
 * Provides a reusable signal system (connect, disconnect, emit) that can be
 * applied to any mock object. This extracts the common pattern from Meta.js,
 * Gio.js, St.js, and Clutter.js mocks.
 */

/**
 * Creates a signal handler system
 * @returns {Object} Object with _signals storage and signal methods
 */
export function createSignalMethods() {
  const _signals = {};

  return {
    _signals,

    /**
     * Connect a callback to a signal
     * @param {string} signal - Signal name
     * @param {Function} callback - Callback function
     * @returns {number} Connection ID
     */
    connect(signal, callback) {
      if (!_signals[signal]) _signals[signal] = [];
      const id = Math.random();
      _signals[signal].push({ id, callback });
      return id;
    },

    /**
     * Disconnect a signal handler by ID
     * @param {number} id - Connection ID returned by connect()
     */
    disconnect(id) {
      for (const signal in _signals) {
        _signals[signal] = _signals[signal].filter((s) => s.id !== id);
      }
    },

    /**
     * Emit a signal with optional arguments
     * @param {string} signal - Signal name
     * @param {...any} args - Arguments to pass to handlers
     */
    emit(signal, ...args) {
      if (_signals[signal]) {
        _signals[signal].forEach((s) => s.callback(...args));
      }
    },

    /**
     * Check if any handlers are connected to a signal
     * @param {string} signal - Signal name
     * @returns {boolean} True if handlers exist
     */
    hasHandlers(signal) {
      return _signals[signal]?.length > 0;
    },

    /**
     * Get the number of handlers for a signal
     * @param {string} signal - Signal name
     * @returns {number} Number of connected handlers
     */
    getHandlerCount(signal) {
      return _signals[signal]?.length ?? 0;
    },

    /**
     * Clear all signal handlers
     */
    clearSignals() {
      for (const signal in _signals) {
        delete _signals[signal];
      }
    },

    /**
     * Disconnect all signal handlers (alias for clearSignals)
     * Convenience method for cleanup
     */
    disconnect_all() {
      for (const signal in _signals) {
        delete _signals[signal];
      }
    },
  };
}

/**
 * Apply signal methods to an existing object
 * @param {Object} target - Object to enhance with signal methods
 * @returns {Object} The target object with signal methods added
 */
export function applySignalMixin(target) {
  const methods = createSignalMethods();
  Object.assign(target, methods);
  return target;
}

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

    clearSignals() {
      for (const signal in this._signals) {
        delete this._signals[signal];
      }
    }

    disconnect_all() {
      for (const signal in this._signals) {
        delete this._signals[signal];
      }
    }
  };
}

export default {
  createSignalMethods,
  applySignalMixin,
  withSignals,
};
