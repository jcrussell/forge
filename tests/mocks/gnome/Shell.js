// Mock Shell namespace

export class Global {
  constructor() {
    this.display = null;
    this.screen = null;
    this.workspace_manager = null;
    this.window_manager = null;
    this.stage = null;
  }

  get_display() {
    return this.display;
  }

  get_screen() {
    return this.screen;
  }

  get_workspace_manager() {
    return this.workspace_manager;
  }

  get_window_manager() {
    return this.window_manager;
  }

  get_stage() {
    return this.stage;
  }
}

export class App {
  constructor(params = {}) {
    this.id = params.id || "mock.app";
    this.name = params.name || "Mock App";
  }

  get_id() {
    return this.id;
  }

  get_name() {
    return this.name;
  }

  get_windows() {
    return [];
  }

  create_icon_texture(size) {
    return {
      width: size,
      height: size,
      set_size: () => {},
      destroy: () => {},
    };
  }
}

export class AppSystem {
  static get_default() {
    return new AppSystem();
  }

  lookup_app(appId) {
    return new App({ id: appId });
  }

  get_running() {
    return [];
  }
}

export class WindowTracker {
  static get_default() {
    return new WindowTracker();
  }

  get_window_app(window) {
    return new App();
  }
}

export const ActionMode = {
  NONE: 0,
  NORMAL: 1 << 0,
  OVERVIEW: 1 << 1,
  LOCK_SCREEN: 1 << 2,
  UNLOCK_SCREEN: 1 << 3,
  LOGIN_SCREEN: 1 << 4,
  SYSTEM_MODAL: 1 << 5,
  LOOKING_GLASS: 1 << 6,
  POPUP: 1 << 7,
  ALL: 0xff,
};

export default {
  Global,
  App,
  AppSystem,
  WindowTracker,
  ActionMode,
};
