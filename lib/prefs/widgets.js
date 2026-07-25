/** @license (c) aylur. GPL v3 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";

import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { Logger } from "../shared/logger.js";

export class PreferencesPage extends Adw.PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  /**
   * @param {{ title: string, description?: string, children: any[], header_suffix?: import('gi://Gtk').default.Widget | null }} opts
   */
  add_group({ title, description = "", children, header_suffix = null }) {
    const group = new Adw.PreferencesGroup({ title, description });
    for (const child of children) group.add(child);
    if (header_suffix) group.set_header_suffix(header_suffix);
    this.add(group);
    return group;
  }
}

export class SwitchRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  constructor({ title, settings, bind, subtitle = "", experimental = false }) {
    super({ title, subtitle });
    const gswitch = new Gtk.Switch({
      active: settings.get_boolean(bind),
      valign: Gtk.Align.CENTER,
    });
    settings.bind(bind, gswitch, "active", Gio.SettingsBindFlags.DEFAULT);
    if (experimental) {
      const icon = new Gtk.Image({ icon_name: "bug-symbolic" });
      icon.set_tooltip_markup(
        _("<b>CAUTION</b>: Enabling this setting can lead to bugs or cause the shell to crash")
      );
      this.add_suffix(icon);
    }
    this.add_suffix(gswitch);
    this.activatable_widget = gswitch;
  }
}

export class ColorRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  constructor({ title, init, onChange, subtitle = "" }) {
    super({ title, subtitle });
    let rgba = new Gdk.RGBA();
    // forge-el84: `init` is undefined when the user's stylesheet is missing the
    // rule or the declaration (getCssProperty returns {}). Gdk.RGBA.parse takes a
    // non-nullable const char*, so GJS THROWS rather than returning false — and
    // the throw escaped AppearancePage's constructor into fillPreferencesWindow,
    // taking Appearance, Keyboard, Windows and Portability out of the prefs
    // window. An unparsed RGBA is transparent black, a valid button state.
    if (typeof init === "string") rgba.parse(init);
    this.colorButton = new Gtk.ColorButton({ rgba, use_alpha: true, valign: Gtk.Align.CENTER });
    this.colorButton.connect("color-set", () => {
      onChange(this.colorButton.get_rgba().to_string());
    });
    this.add_suffix(this.colorButton);
    this.activatable_widget = this.colorButton;
  }
}

export class SpinButtonRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {[number, number, number]} opts.range
   * @param {string} [opts.subtitle]
   * @param {number | string} [opts.init] numeric seed; CSS-derived callers pass a numeric string
   * @param {(value: number) => void} [opts.onChange]
   * @param {number} [opts.max_width_chars]
   * @param {number} [opts.max_length]
   * @param {number} [opts.width_chars]
   * @param {number} [opts.xalign]
   * @param {Gio.Settings} [opts.settings]
   * @param {string} [opts.bind]
   */
  constructor({
    title,
    range: [low, high, step],
    subtitle = "",
    init = undefined,
    onChange = undefined,
    max_width_chars = undefined,
    max_length = undefined,
    width_chars = undefined,
    xalign = undefined,
    settings = undefined,
    bind = undefined,
  }) {
    super({ title, subtitle });
    const gspin = Gtk.SpinButton.new_with_range(low, high, step);
    gspin.xalign = 1;
    if (bind && settings) {
      settings.bind(bind, gspin, "value", Gio.SettingsBindFlags.DEFAULT);
    } else if (init !== undefined) {
      gspin.value = Number(init);
    }
    if (onChange) {
      gspin.connect("value-changed", (widget) => onChange(widget.value));
      // Reconcile the stylesheet with the persisted/init value once. Bind/seed
      // ran above, so this does not fire during the construction sync. Safe to
      // run on every prefs open because setCssProperty is idempotent (forge-w3ss).
      onChange(gspin.value);
    }
    this.add_suffix(gspin);
    this.set_css_classes(["spin"]);
    this.activatable_widget = gspin;
  }
}

export class DropDownRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  /**
   * @type {string}
   * Name of the gsetting key to bind to
   */
  bind;

  /**
   * @type {'b'|'y'|'n'|'q'|'i'|'u'|'x'|'t'|'h'|'d'|'s'|'o'|'g'|'?'|'a'|'m'}
   * - b: the type string of G_VARIANT_TYPE_BOOLEAN; a boolean value.
   * - y: the type string of G_VARIANT_TYPE_BYTE; a byte.
   * - n: the type string of G_VARIANT_TYPE_INT16; a signed 16 bit integer.
   * - q: the type string of G_VARIANT_TYPE_UINT16; an unsigned 16 bit integer.
   * - i: the type string of G_VARIANT_TYPE_INT32; a signed 32 bit integer.
   * - u: the type string of G_VARIANT_TYPE_UINT32; an unsigned 32 bit integer.
   * - x: the type string of G_VARIANT_TYPE_INT64; a signed 64 bit integer.
   * - t: the type string of G_VARIANT_TYPE_UINT64; an unsigned 64 bit integer.
   * - h: the type string of G_VARIANT_TYPE_HANDLE; a signed 32 bit value that, by convention, is used as an index into an array of file descriptors that are sent alongside a D-Bus message.
   * - d: the type string of G_VARIANT_TYPE_DOUBLE; a double precision floating point value.
   * - s: the type string of G_VARIANT_TYPE_STRING; a string.
   * - o: the type string of G_VARIANT_TYPE_OBJECT_PATH; a string in the form of a D-Bus object path.
   * - g: the type string of G_VARIANT_TYPE_SIGNATURE; a string in the form of a D-Bus type signature.
   * - ?: the type string of G_VARIANT_TYPE_BASIC; an indefinite type that is a supertype of any of the basic types.
   * - v: the type string of G_VARIANT_TYPE_VARIANT; a container type that contain any other type of value.
   * - a: used as a prefix on another type string to mean an array of that type; the type string “ai”, for example, is the type of an array of signed 32-bit integers.
   * - m: used as a prefix on another type string to mean a “maybe”, or “nullable”, version of that type; the type string “ms”, for example, is the type of a value that maybe contains a string, or maybe contains nothing.
   */
  type;

  selected = 0;

  /** @type {{name: string; id: string}[]} */
  items;

  model = new Gtk.StringList();

  /** @type {Gtk.DropDown} */
  dropdown;

  constructor({ title, settings, bind, items, subtitle = "", type }) {
    super({ title, subtitle });
    this.settings = settings;
    this.items = items;
    this.bind = bind;
    this.type = type ?? this.settings.get_value(bind)?.get_type() ?? "?";
    this.#build();
    this.add_suffix(this.dropdown);
    this.add_suffix(new ResetButton({ settings, bind, onReset: () => this.reset() }));

    // forge-cypb: this row read its gsetting once at construction, so an
    // external write (Portability -> Import) left it showing the pre-import
    // value. #syncing gates #onSelected: assigning dropdown.selected emits
    // notify::selected, and when the external value is not in `items`
    // #currentIndex() falls back to 0 — writing items[0].id straight back over
    // the value we were told about (the forge-egnf clobber).
    this._settingsChangedId = settings.connect(`changed::${bind}`, () => {
      const idx = this.#currentIndex();
      if (idx === this.dropdown.selected) return;
      this.#syncing = true;
      try {
        this.selected = idx;
        this.dropdown.selected = idx;
      } finally {
        this.#syncing = false;
      }
    });
  }

  vfunc_unroot() {
    if (this._settingsChangedId) {
      this.settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    super.vfunc_unroot();
  }

  reset() {
    // ResetButton has already restored the gschema default into GSettings; select
    // the item matching that value instead of forcing index 0, which silently
    // wrote items[0].id over the just-restored default (forge-egnf).
    const idx = this.#currentIndex();
    this.selected = idx;
    this.dropdown.selected = idx;
  }

  #build() {
    for (const { name } of this.items) {
      this.model.append(name);
    }
    this.selected = this.#currentIndex();
    const { model, selected } = this;
    this.dropdown = new Gtk.DropDown({ valign: Gtk.Align.CENTER, model, selected });
    this.dropdown.connect("notify::selected", () => this.#onSelected());
    this.activatable_widget = this.dropdown;
  }

  /** Index of the item whose id equals the current GSetting value, else 0. */
  #currentIndex() {
    const cur = this.#get();
    const idx = this.items.findIndex((x) => x.id === cur);
    return idx >= 0 ? idx : 0;
  }

  #syncing = false;

  #onSelected() {
    if (this.#syncing) return;
    this.selected = this.dropdown.selected;
    const { id } = this.items[this.selected];
    Logger.debug("setting", id, this.selected);
    this.#set(this.bind, id);
  }

  static #settingsTypes = {
    b: "boolean",
    y: "byte",
    n: "int16",
    q: "uint16",
    i: "int32",
    u: "uint",
    x: "int64",
    t: "uint64",
    d: "double",
    s: "string",
    o: "objv",
  };

  /**
   * @param {string} x
   */
  #get(x = this.bind) {
    const methodName = `get_${DropDownRow.#settingsTypes[this.type] ?? "value"}`;
    return this.settings[methodName]?.(x);
  }

  /**
   * @param {string} x
   * @param {unknown} y
   */
  #set(x, y) {
    const methodName = `set_${DropDownRow.#settingsTypes[this.type] ?? "value"}`;
    Logger.log(`${methodName}(${x}, ${y})`);
    return this.settings[methodName]?.(x, y);
  }
}

export class ClearButton extends Gtk.Button {
  static {
    GObject.registerClass(this);
  }
  /**
   * @param {object} opts
   * @param {Gio.Settings} [opts.settings]
   * @param {string} [opts.bind]
   * @param {() => void} [opts.onClear]
   */
  constructor({ settings = undefined, bind = undefined, onClear }) {
    super({
      icon_name: "edit-clear-symbolic",
      tooltip_text: _("Clear shortcut"),
      css_classes: ["flat", "circular"],
      valign: Gtk.Align.CENTER,
    });
    this.connect("clicked", () => {
      onClear?.();
    });
  }
}

export class ResetButton extends Gtk.Button {
  static {
    GObject.registerClass(this);
  }
  /**
   * @param {object} opts
   * @param {Gio.Settings} [opts.settings]
   * @param {string} [opts.bind]
   * @param {() => void} [opts.onReset]
   */
  constructor({ settings = undefined, bind = undefined, onReset }) {
    super({
      icon_name: "edit-undo-symbolic",
      tooltip_text: _("Reset to default"),
      css_classes: ["flat", "circular"],
      valign: Gtk.Align.CENTER,
    });
    this.connect("clicked", () => {
      if (bind) settings?.reset(bind);
      onReset?.();
    });
  }
}

export class RemoveButton extends Gtk.Button {
  static {
    GObject.registerClass(this);
  }
  constructor({ item, parent, onRemove }) {
    super({
      icon_name: "edit-delete-symbolic",
      tooltip_text: _("Remove Item"),
      css_classes: ["flat", "circular"],
      valign: Gtk.Align.CENTER,
    });
    this.connect("clicked", () => {
      onRemove?.(item, parent);
    });
  }
}

export class EntryRow extends Adw.EntryRow {
  static {
    GObject.registerClass(this);
  }

  static DEBOUNCE_MS = 1000;

  /** @type {number | null} */
  _saveSourceId = null;

  /** @type {number | null} */
  _settingsChangedId = null;

  /**
   * @typedef {object} EntryMap
   * @property {(settings: Gio.Settings, bind: string) => string} from
   * @property {(settings: Gio.Settings, bind: string, value: string) => boolean} to
   * @property {(settings: Gio.Settings, bind: string) => (string | null)} [warn]
   */

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {Gio.Settings} opts.settings
   * @param {string} opts.bind
   * @param {EntryMap} [opts.map]
   */
  constructor({ title, settings, bind, map = undefined }) {
    super({ title });
    let initialized = false;
    this._saveSourceId = null;

    const save = () => {
      const text = this.get_text();
      if (typeof text === "string") {
        let valid = true;
        if (map) {
          valid = map.to(settings, bind, text) !== false;
        } else {
          settings.set_string(bind, text);
        }
        const root = /** @type {Adw.PreferencesWindow | null} */ (this.get_root());
        if (valid) {
          this.remove_css_class("error");
          // A saved-but-conflicting value (e.g. a keybinding already bound
          // elsewhere) is surfaced, not rejected: keep the value, flag the row
          // with a "warning" class + tooltip so the user can resolve it. Other
          // rows use no warn hook and fall through to the normal "Saved" toast.
          const warning = map?.warn ? map.warn(settings, bind) : null;
          if (warning) {
            this.add_css_class("warning");
            this.set_tooltip_text(warning);
            if (root?.add_toast) {
              root.add_toast(new Adw.Toast({ title: warning, timeout: 3 }));
            }
          } else {
            this.remove_css_class("warning");
            this.set_tooltip_text(null);
            if (root?.add_toast) {
              root.add_toast(new Adw.Toast({ title: _("Saved"), timeout: 1 }));
            }
          }
        } else {
          this.add_css_class("error");
          if (root?.add_toast) {
            root.add_toast(new Adw.Toast({ title: _("Invalid input"), timeout: 2 }));
          }
        }
      }
    };

    /** Run save() now instead of waiting out the debounce. */
    const flush = () => {
      if (this._saveSourceId) {
        GLib.source_remove(this._saveSourceId);
        this._saveSourceId = null;
      }
      save();
    };

    this.connect("changed", () => {
      if (!initialized) {
        initialized = true;
        return;
      }
      // forge-cypb: `initialized` cannot double as the resync guard — it is
      // consumed by the first set_text below and stays true forever after, so a
      // programmatic re-seed would schedule a debounce and write straight back.
      if (this._syncing) return;
      if (this._saveSourceId) {
        GLib.source_remove(this._saveSourceId);
      }
      this._saveSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, EntryRow.DEBOUNCE_MS, () => {
        save();
        this._saveSourceId = null;
        return GLib.SOURCE_REMOVE;
      });
    });

    // forge-dhyz: the Keyboard page tells the user "to apply a shortcut press
    // enter", but nothing implemented it — the only save path was the 1s
    // debounce, which vfunc_unroot CANCELS on window close. Editing a shortcut
    // and closing prefs within a second silently discarded it, after an explicit
    // (false) confirmation cue.
    this.connect("entry-activated", flush);

    const readCurrent = () => (map ? map.from(settings, bind) : settings.get_string(bind)) ?? "";

    // forge-cypb: this row used to read its gsetting exactly once. Keyboard's
    // "Disable All"/"Restore Defaults" and Portability's Import all write the
    // keys directly, so every built row kept displaying its stale value — and
    // appending to a stale field wrote the OLD accel back, silently restoring a
    // binding the user had just disabled.
    this._settingsChangedId = settings.connect(`changed::${bind}`, () => {
      const value = readCurrent();
      if (value === this.get_text()) return;
      this._syncing = true;
      try {
        if (this._saveSourceId) {
          GLib.source_remove(this._saveSourceId);
          this._saveSourceId = null;
        }
        this.set_text(value);
        this.remove_css_class("error");
        this.remove_css_class("warning");
        this.set_tooltip_text(null);
      } finally {
        this._syncing = false;
      }
    });

    this._settings = settings;
    this.set_text(readCurrent());
    this.add_suffix(
      new ClearButton({
        settings,
        bind,
        onClear: () => {
          this.set_text("");
        },
      })
    );
    this.add_suffix(
      new ResetButton({
        settings,
        bind,
        onReset: () => {
          this.set_text(readCurrent());
        },
      })
    );
  }

  vfunc_unroot() {
    // Cancel a pending debounced save so the timeout can't fire save() — which
    // calls get_text()/get_root() — on a finalized widget after the prefs window
    // closes (forge-3qj3). unroot (not unmap) is used so collapsing an
    // ExpanderRow, which only unmaps its rows, doesn't drop a live edit.
    if (this._saveSourceId) {
      GLib.source_remove(this._saveSourceId);
      this._saveSourceId = null;
    }
    // forge-cypb: release the resync handler with the widget.
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    super.vfunc_unroot();
  }
}

export class RadioRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  static orientation = Gtk.Orientation.HORIZONTAL;

  static spacing = 3;

  static valign = Gtk.Align.CENTER;

  constructor({ title, subtitle = "", settings, bind, options }) {
    super({ title, subtitle });
    const current = settings.get_string(bind);
    const labels = Object.fromEntries(Object.entries(options).map(([k, v]) => [v, k]));
    const { orientation, spacing, valign } = RadioRow;
    const hbox = new Gtk.Box({ orientation, spacing, valign });
    const toggles = [];
    let group;
    for (const [key, label] of Object.entries(options)) {
      const toggle = new Gtk.ToggleButton({ label, ...(group && { group }) });
      group ||= toggle;
      toggle.active = key === current;
      toggle.set_css_classes(["flat"]);
      toggle.connect("clicked", () => {
        if (toggle.active) {
          settings.set_string(bind, labels[toggle.label]);
        }
      });
      toggles.push([key, toggle]);
      hbox.append(toggle);
    }
    this.add_suffix(hbox);

    // forge-cypb: read-once like the other rows, so Portability -> Import left
    // mod-mask-mouse-tile showing the pre-import value. No resync guard is
    // needed here: GTK4's set_active() emits `toggled`, not `clicked`, so the
    // write-back handler above cannot re-fire.
    this._settings = settings;
    this._settingsChangedId = settings.connect(`changed::${bind}`, () => {
      const value = settings.get_string(bind);
      for (const [key, toggle] of toggles) toggle.active = key === value;
    });
  }

  vfunc_unroot() {
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    super.vfunc_unroot();
  }
}

export class RemoveItemRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} [opts.subtitle]
   * @param {(item: any, parent: any) => void} [opts.onRemove]
   */
  constructor({ title, subtitle = "", onRemove = undefined }) {
    super({ title, subtitle });
    const rmbutton = new RemoveButton({
      item: subtitle,
      parent: this,
      onRemove: onRemove,
    });

    this.add_suffix(rmbutton);
  }
}
