// Mock GObject namespace
import { withSignals } from "../helpers/signalMixin.js";

// Legacy helper functions for external use (still work with any object)
export function signal_connect(object, signal, callback) {
  if (!object._signals) object._signals = {};
  if (!object._signals[signal]) object._signals[signal] = [];
  const id = Math.random();
  object._signals[signal].push({ id, callback });
  return id;
}

export function signal_disconnect(object, id) {
  if (!object._signals) return;
  for (const signal in object._signals) {
    object._signals[signal] = object._signals[signal].filter((s) => s.id !== id);
  }
}

export function signal_emit(object, signal, ...args) {
  if (!object._signals || !object._signals[signal]) return;
  object._signals[signal].forEach((s) => s.callback(...args));
}

export const SignalFlags = {
  RUN_FIRST: 1 << 0,
  RUN_LAST: 1 << 1,
  RUN_CLEANUP: 1 << 2,
  NO_RECURSE: 1 << 3,
  DETAILED: 1 << 4,
  ACTION: 1 << 5,
  NO_HOOKS: 1 << 6,
};

// GObjectBase now uses signal mixin for DRY implementation
class GObjectBase extends withSignals() {
  constructor() {
    super();
  }
}

export { GObjectBase as Object };

// Mock for GObject.registerClass
export function registerClass(klass) {
  // In real GObject, this would register the class with the type system
  // For testing, we just return the class unchanged
  return klass;
}

export default {
  signal_connect,
  signal_disconnect,
  signal_emit,
  SignalFlags,
  Object: GObjectBase,
  registerClass,
};
