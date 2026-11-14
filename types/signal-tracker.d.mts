// GNOME Shell's misc/signalTracker.js adds connectObject/disconnectObject to
// GObject.Object.prototype in the shell process (not in prefs); @girs does not
// declare them. An ES module, so the augmentation targets the same
// @girs/gobject-2.0 entry point (the "import" condition) that the other @girs
// packages resolve.
import "@girs/gobject-2.0";
import "@girs/meta-13/meta-13";
import "@girs/shell-13/shell-13";

interface SignalTrackerMethods {
  connectObject(...args: unknown[]): void;
  disconnectObject(owner: object): void;
}

declare module "@girs/gobject-2.0" {
  export namespace GObject {
    interface Object extends SignalTrackerMethods {}
  }
}

// @girs/meta-13 and @girs/shell-13 extend their own nested copy of
// @girs/gobject-2.0, which the augmentation above does not reach, so the
// singletons Forge connects to with connectObject are declared here.
declare module "@girs/meta-13/meta-13" {
  export namespace Meta {
    interface Display extends SignalTrackerMethods {}
    interface WorkspaceManager extends SignalTrackerMethods {}
  }
}

declare module "@girs/shell-13/shell-13" {
  export namespace Shell {
    interface WM extends SignalTrackerMethods {}
  }
}
