// Mock Meta namespace (Meta window manager APIs)
import { withSignals } from "../helpers/signalMixin.js";

export class Rectangle {
  constructor(params = {}) {
    this.x = params.x || 0;
    this.y = params.y || 0;
    this.width = params.width || 100;
    this.height = params.height || 100;
  }

  equal(other) {
    return (
      this.x === other.x &&
      this.y === other.y &&
      this.width === other.width &&
      this.height === other.height
    );
  }

  contains_rect(other) {
    return (
      this.x <= other.x &&
      this.y <= other.y &&
      this.x + this.width >= other.x + other.width &&
      this.y + this.height >= other.y + other.height
    );
  }

  overlap(other) {
    return !(
      this.x + this.width <= other.x ||
      other.x + other.width <= this.x ||
      this.y + this.height <= other.y ||
      other.y + other.height <= this.y
    );
  }

  copy() {
    return new Rectangle({
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    });
  }
}

export class Window extends withSignals() {
  constructor(params = {}) {
    super();
    this.id = params.id ?? Math.random();
    this._rect = params.rect ?? new Rectangle();
    // Use 'in' operator to allow null/empty values to be explicitly set
    this.wm_class = "wm_class" in params ? params.wm_class : "MockApp";
    this.title = "title" in params ? params.title : "Mock Window";
    this.maximized_horizontally = params.maximized_horizontally ?? false;
    this.maximized_vertically = params.maximized_vertically ?? false;
    this.minimized = params.minimized ?? false;
    this.fullscreen = params.fullscreen ?? false;
    this._window_type = "window_type" in params ? params.window_type : WindowType.NORMAL;
    this._transient_for = "transient_for" in params ? params.transient_for : null;
    this._allows_resize = "allows_resize" in params ? params.allows_resize : true;
    this._workspace = params.workspace ?? null;
    this._monitor = params.monitor ?? 0;
    this._size_hints = params.size_hints ?? null;
    this._on_all_workspaces = params.on_all_workspaces ?? false;
    this._always_on_all_workspaces = params.always_on_all_workspaces ?? false;
  }

  get_size_hints() {
    return this._size_hints;
  }

  get_frame_rect() {
    return this._rect;
  }

  get_buffer_rect() {
    return this._rect;
  }

  get_work_area_current_monitor() {
    return new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 });
  }

  get_work_area_for_monitor(monitorIndex) {
    // Default implementation, tests can override this
    return new Rectangle({ x: monitorIndex * 1920, y: 0, width: 1920, height: 1080 });
  }

  move_resize_frame(interactive, x, y, width, height) {
    this._rect = new Rectangle({ x, y, width, height });
  }

  move_frame(interactive, x, y) {
    this._rect.x = x;
    this._rect.y = y;
  }

  get_wm_class() {
    return this.wm_class;
  }

  // Test helper: emulate a late-arriving wm_class (Anki/Opera/Flatpaks report
  // null at map time). Mirrors make_above() — sets the value and fires the
  // notify::wm-class signal Forge listens for. forge-3qq (#482).
  set_wm_class(value) {
    this.wm_class = value;
    this.emit("notify::wm-class");
  }

  get_title() {
    return this.title;
  }

  get_workspace() {
    return this._workspace;
  }

  get_monitor() {
    return this._monitor;
  }

  is_on_all_workspaces() {
    return this._on_all_workspaces;
  }

  // forge-16ms: the user-requested "Always on Visible Workspace" pin, distinct from
  // the EFFECTIVE sticky state Mutter sets implicitly for a non-primary-monitor
  // window under workspaces-only-on-primary=true.
  is_always_on_all_workspaces() {
    return this._always_on_all_workspaces;
  }

  // Test helper: pin/unpin "Always on Visible Workspace" — a USER pin sets both the
  // requested flag and the effective state. forge-yyum.
  stick() {
    this._on_all_workspaces = true;
    this._always_on_all_workspaces = true;
  }

  unstick() {
    this._on_all_workspaces = false;
    this._always_on_all_workspaces = false;
  }

  // forge-16ms: Mutter's IMPLICIT stickiness for a window on a non-primary monitor
  // under workspaces-only-on-primary=true — effective sticky with NO user pin.
  stickImplicit() {
    this._on_all_workspaces = true;
  }

  showing_on_its_workspace() {
    return !this.minimized;
  }

  change_workspace(workspace) {
    this._workspace = workspace;
  }

  maximize(directions) {
    // Mutter 48 calls maximize(flags); Mutter 49+ calls set_maximize_flags(flags)
    // then maximize() with no args. Honor an explicit `directions` arg, else any
    // flags staged via set_maximize_flags(), else default to BOTH — so partial
    // maximize round-trips through get_maximize_flags()/get_maximized().
    const flags = directions ?? this._pendingMaximizeFlags ?? MaximizeFlags.BOTH;
    this.maximized_horizontally = Boolean(flags & MaximizeFlags.HORIZONTAL);
    this.maximized_vertically = Boolean(flags & MaximizeFlags.VERTICAL);
    this._pendingMaximizeFlags = null;
  }

  unmaximize(directions) {
    this.maximized_horizontally = false;
    this.maximized_vertically = false;
  }

  get_maximized() {
    // Return maximization state as flags
    if (this.maximized_horizontally && this.maximized_vertically) {
      return 3; // BOTH
    }
    if (this.maximized_horizontally) return 1; // HORIZONTAL
    if (this.maximized_vertically) return 2; // VERTICAL
    return 0; // NONE
  }

  is_fullscreen() {
    return this.fullscreen;
  }

  make_fullscreen() {
    this.fullscreen = true;
  }

  unmake_fullscreen() {
    this.fullscreen = false;
  }

  is_above() {
    return this.above || false;
  }

  make_above() {
    this.above = true;
    this.emit("notify::above");
  }

  unmake_above() {
    this.above = false;
    this.emit("notify::above");
  }

  minimize() {
    this.minimized = true;
  }

  unminimize() {
    this.minimized = false;
  }

  raise() {
    // Mock raise operation
  }

  lower() {
    // Mock lower operation
  }

  focus(timestamp) {
    // Mock focus operation
  }

  activate(timestamp) {
    this.focus(timestamp);
  }

  delete(timestamp) {
    // Mock delete operation
  }

  allows_resize() {
    return this._allows_resize;
  }

  get_window_type() {
    return this._window_type;
  }

  get_transient_for() {
    return this._transient_for;
  }

  get_id() {
    return this.id;
  }

  get_display() {
    return global.display || null;
  }

  move_to_monitor(monitorIndex) {
    this._monitor = monitorIndex;
  }

  appears_focused() {
    return this.appears_focused_value ?? false;
  }

  get_stable_sequence() {
    return this.id;
  }

  get_compositor_private() {
    // Return a mock actor object
    if (!this._actor) {
      this._actor = {
        border: null,
        splitBorder: null,
        actorSignals: null,
        remove_all_transitions: () => {
          // Mock method for removing window transitions
        },
        connect: (signal, callback) => {
          // Mock signal connection
          return Math.random();
        },
        disconnect: (id) => {
          // Mock signal disconnection
        },
      };
    }
    return this._actor;
  }

  set_unmaximize_flags(flags) {
    // GNOME 49+ method
  }

  // Mutter 49+ Meta.Window API (see lib/extension/compat.js). On real Mutter 49+,
  // maximize state is staged with set_maximize_flags() and applied by maximize().
  set_maximize_flags(flags) {
    this._pendingMaximizeFlags = flags;
  }

  is_maximized() {
    return this.maximized_horizontally && this.maximized_vertically;
  }

  get_maximize_flags() {
    // Same packed-flags representation as get_maximized().
    return this.get_maximized();
  }
}

export class Workspace extends withSignals() {
  constructor(params = {}) {
    super();
    this._index = params.index || 0;
    this._windows = [];
  }

  index() {
    return this._index;
  }

  list_windows() {
    return this._windows;
  }

  get_work_area_for_monitor(monitorIndex) {
    // Return default work area for monitor
    return new Rectangle({ x: monitorIndex * 1920, y: 0, width: 1920, height: 1080 });
  }

  activate_with_focus(window, timestamp) {
    // Mock activation
  }
}

export class Display extends withSignals() {
  constructor() {
    super();
    this._workspaces = [];
  }

  get_workspace_manager() {
    return {
      get_n_workspaces: () => this._workspaces.length,
      get_workspace_by_index: (index) => this._workspaces[index] || null,
      get_workspaces: () => this._workspaces,
    };
  }
}

// Enums and constants
export const WindowType = {
  NORMAL: 0,
  DESKTOP: 1,
  DOCK: 2,
  DIALOG: 3,
  MODAL_DIALOG: 4,
  TOOLBAR: 5,
  MENU: 6,
  UTILITY: 7,
  SPLASHSCREEN: 8,
  DROPDOWN_MENU: 9,
  POPUP_MENU: 10,
  TOOLTIP: 11,
  NOTIFICATION: 12,
  COMBO: 13,
  DND: 14,
  OVERRIDE_OTHER: 15,
};

export const DisplayDirection = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3,
};

export const MotionDirection = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3,
  UP_LEFT: 4,
  UP_RIGHT: 5,
  DOWN_LEFT: 6,
  DOWN_RIGHT: 7,
};

export const Side = {
  LEFT: 1 << 0,
  RIGHT: 1 << 1,
  TOP: 1 << 2,
  BOTTOM: 1 << 3,
};

export const MaximizeFlags = {
  HORIZONTAL: 1 << 0,
  VERTICAL: 1 << 1,
  BOTH: (1 << 0) | (1 << 1),
};

export const GrabOp = {
  NONE: 0,
  MOVING: 1,
  MOVING_UNCONSTRAINED: 1 | 1024,
  KEYBOARD_MOVING: 19,
  RESIZING_NW: 2,
  RESIZING_N: 3,
  RESIZING_NE: 4,
  RESIZING_E: 5,
  RESIZING_SE: 6,
  RESIZING_S: 7,
  RESIZING_SW: 8,
  RESIZING_W: 9,
  KEYBOARD_RESIZING_UNKNOWN: 10,
  KEYBOARD_RESIZING_N: 11,
  KEYBOARD_RESIZING_S: 12,
  KEYBOARD_RESIZING_E: 13,
  KEYBOARD_RESIZING_W: 14,
  KEYBOARD_RESIZING_NW: 15,
  KEYBOARD_RESIZING_NE: 16,
  KEYBOARD_RESIZING_SE: 17,
  KEYBOARD_RESIZING_SW: 18,
  // Distinct non-colliding sentinels (real Mutter uses bitfield values; tests only
  // need identity). WINDOW_BASE = window-decoration drag, COMPOSITOR = shell grab.
  WINDOW_BASE: 1024,
  COMPOSITOR: 2048,
};

export const TabList = {
  NORMAL: 0,
  DOCKS: 1,
  GROUP: 2,
  NORMAL_ALL: 3,
};

export const KeyBindingFlags = {
  NONE: 0,
  IS_REVERSED: 1,
  IS_BUILTIN: 2,
  PER_WINDOW: 4,
};

export const KeyBindingAction = {
  NONE: 0,
};

export function external_binding_name_for_action(action) {
  return `binding-${action}`;
}

// Module-level Wayland flag (default false) so tests can exercise the Wayland
// buffer-scale paths that production guards behind is_wayland_compositor().
let _wayland = false;
export function is_wayland_compositor() {
  return _wayland;
}
export function __setWayland(value) {
  _wayland = value;
}

export default {
  Rectangle,
  Window,
  Workspace,
  Display,
  WindowType,
  DisplayDirection,
  MotionDirection,
  Side,
  MaximizeFlags,
  GrabOp,
  TabList,
  KeyBindingFlags,
  KeyBindingAction,
  external_binding_name_for_action,
  is_wayland_compositor,
  __setWayland,
};
