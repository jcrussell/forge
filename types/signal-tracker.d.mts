// GNOME Shell's misc/signalTracker.js adds connectObject/disconnectObject to
// GObject.Object.prototype in the shell process (not in prefs); @girs does not
// declare them. An ES module, so the augmentation targets the same
// @girs/gobject-2.0 entry point (the "import" condition) that the other @girs
// packages resolve.
import "@girs/gobject-2.0";

declare module "@girs/gobject-2.0" {
  export namespace GObject {
    interface Object {
      connectObject(...args: unknown[]): void;
      disconnectObject(owner: object): void;
    }
  }
}
