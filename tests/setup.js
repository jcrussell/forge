// Register global mocks before tests run
import { vi } from "vitest";
import * as GnomeMocks from "./mocks/gnome/index.js";

// Mock the gi:// import scheme used by GNOME Shell ESM
// The extension uses: import Meta from "gi://Meta"
vi.mock("gi://Meta", () => GnomeMocks.Meta);
vi.mock("gi://Gio", () => GnomeMocks.Gio);
vi.mock("gi://GLib", () => GnomeMocks.GLib);
vi.mock("gi://Shell", () => GnomeMocks.Shell);
vi.mock("gi://St", () => GnomeMocks.St);
vi.mock("gi://Clutter", () => GnomeMocks.Clutter);
vi.mock("gi://GObject", () => GnomeMocks.GObject);

// Create shared mock objects that tests can modify
// Using vi.hoisted() ensures these are created before mocks and are mutable
const { mockOverview, mockWm, mockPanel } = vi.hoisted(() => {
  return {
    mockOverview: {
      visible: false,
      connect: (signal, callback) => Math.random(),
      disconnect: (id) => {},
      _signals: {},
    },
    mockWm: {
      addKeybinding: () => {},
      removeKeybinding: () => {},
      allowKeybinding: () => {},
    },
    mockPanel: {
      statusArea: {
        quickSettings: {
          addExternalIndicator: () => {},
        },
      },
    },
  };
});

// Mock GNOME Shell resources
vi.mock("resource:///org/gnome/shell/misc/config.js", () => ({
  PACKAGE_VERSION: "47.0",
}));

vi.mock("resource:///org/gnome/shell/extensions/extension.js", () => ({
  Extension: class Extension {
    constructor() {
      this.metadata = {};
      this.dir = { get_path: () => "/mock/path" };
    }
    getSettings() {
      return GnomeMocks.Gio.Settings.new();
    }
  },
  gettext: (str) => str,
}));

// The diagnostic log's first-run question (lib/extension/diagnostics-prompt.js)
vi.mock("resource:///org/gnome/shell/ui/dialog.js", () => ({
  MessageDialogContent: class MessageDialogContent {
    constructor(params) {
      Object.assign(this, params);
    }
  },
}));

vi.mock("resource:///org/gnome/shell/ui/modalDialog.js", () => ({
  ModalDialog: class ModalDialog {
    constructor() {
      this.contentLayout = { add_child: () => {} };
      this.buttons = [];
      this._closed = [];
    }
    setButtons(buttons) {
      this.buttons = buttons;
    }
    connect(signal, callback) {
      if (signal === "closed") this._closed.push(callback);
      return this._closed.length;
    }
    open() {
      this.opened = true;
      return true;
    }
    close() {
      this.opened = false;
      this._closed.forEach((callback) => callback());
    }
    destroy() {}
  },
}));

vi.mock("resource:///org/gnome/shell/ui/main.js", () => ({
  overview: mockOverview,
  wm: mockWm,
  panel: mockPanel,
  notify: () => {},
  modalCount: 0,
  sessionMode: { isLocked: false },
}));

// Also set global.Main to use the same overview object reference
global.Main = {
  overview: mockOverview,
  wm: mockWm,
  panel: mockPanel,
  notify: () => {},
};

// Mock Extension class for extension.js
global.Extension = class Extension {
  constructor() {
    this.metadata = {};
    this.dir = { get_path: () => "/mock/path" };
  }
  getSettings() {
    return GnomeMocks.Gio.Settings.new();
  }
};

// Mock global.window_group for GNOME Shell
global.window_group = {
  _children: [],
  contains: function (child) {
    return this._children.includes(child);
  },
  add_child: function (child) {
    if (!this._children.includes(child)) {
      this._children.push(child);
    }
  },
  remove_child: function (child) {
    const index = this._children.indexOf(child);
    if (index !== -1) {
      this._children.splice(index, 1);
    }
  },
};

// Mock global.stage for GNOME Shell
global.stage = {
  get_width: () => 1920,
  get_height: () => 1080,
};
