// Ambient type wiring for the GNOME Shell / GJS runtime (forge-fhen.2).
//
// The extension sources import GObject-Introspection namespaces with unversioned
// specifiers (e.g. `import St from "gi://St"`) and rely on GNOME Shell runtime
// modules (`resource:///org/gnome/shell/...`) plus the Shell `global` object.
// None of these resolve from the raw @girs namespace packages on their own — each
// package ships an `/ambient` entry that declares the unversioned `gi://X` module
// (mapping it to the versioned one), and @girs/gnome-shell supplies the Shell
// `resource://` module maps and globals. Pulling them in here (a file included via
// tsconfig `types/**/*`) makes those declarations part of the program.

// GJS runtime ambients (console/print/etc. + unversioned gi:// base namespaces).
import "@girs/gjs/ambient";
// GJS DOM-style globals (TextDecoder/TextEncoder, etc.).
import "@girs/gjs/dom";
import "@girs/glib-2.0/ambient";
import "@girs/gobject-2.0/ambient";
import "@girs/gio-2.0/ambient";

// Shell-side GI namespaces (Clutter/Meta/Shell/St) used by the extension.
import "@girs/clutter-13/ambient";
import "@girs/meta-13/ambient";
import "@girs/shell-13/ambient";
import "@girs/st-13/ambient";

// Prefs-side GTK stack (Gdk/Gtk/Adw) used by prefs.js / lib/prefs/*.
import "@girs/gdk-4.0/ambient";
import "@girs/gtk-4.0/ambient";
import "@girs/adw-1/ambient";

// GNOME Shell resource:/// module maps (ui/*, misc/*, extensions/*).
import "@girs/gnome-shell/ambient";

// GNOME Shell globals: `global` (Shell.Global) and friends.
import "@girs/gnome-shell/extensions/global";
