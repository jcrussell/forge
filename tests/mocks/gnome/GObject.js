// Mock GObject namespace
import { withSignals } from "../helpers/signalMixin.js";

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
  SignalFlags,
  Object: GObjectBase,
  registerClass,
};
