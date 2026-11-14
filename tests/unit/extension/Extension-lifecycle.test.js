import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Settings as MockSettings } from "../../mocks/gnome/Gio.js";

// Stub the managers so enable() runs to the end; this test is about the signal
// handlers extension.js itself connects.
vi.mock("../../../lib/extension/window.js", () => ({
  WindowManager: class {
    enable() {}
    disable() {}
  },
}));
vi.mock("../../../lib/extension/keybindings.js", () => ({
  Keybindings: class {
    enable() {}
    disable() {}
  },
}));
vi.mock("../../../lib/extension/cheatsheet.js", () => ({
  Cheatsheet: class {
    destroy() {}
  },
}));
vi.mock("../../../lib/extension/extension-theme-manager.js", () => ({
  ExtensionThemeManager: class {
    patchCss() {}
    reloadStylesheet() {}
    unloadStylesheet() {}
  },
}));
vi.mock("../../../lib/shared/config-sync.js", () => ({
  ConfigSync: class {
    init() {}
    destroy() {}
  },
}));
vi.mock("../../../lib/extension/indicator.js", () => ({
  FeatureIndicator: class {
    quickSettingsItems = [];
    destroy() {}
  },
  FeatureMenuToggle: class {
    destroy() {}
  },
}));
vi.mock("../../../lib/shared/settings.js", async (importOriginal) => ({
  ...(await importOriginal()),
  ConfigManager: class {},
}));

import ForgeExtension from "../../../extension.js";

const RECONCILE_SIGNALS = ["changed::tiling-mode-enabled", "changed::disable-edge-tiling"];

describe("ForgeExtension signal lifecycle", () => {
  let ext;
  let settings;
  let realSchemaSource;

  beforeEach(() => {
    // No GNOME schema is present, so every override is skipped.
    realSchemaSource = Gio.SettingsSchemaSource;
    Gio.SettingsSchemaSource = { get_default: () => null };
    settings = new MockSettings("org.gnome.shell.extensions.forge");
    const kbdSettings = new MockSettings("org.gnome.shell.extensions.forge.keybindings");
    ext = new ForgeExtension();
    ext.getSettings = vi.fn((schema) => (schema ? kbdSettings : settings));
  });

  afterEach(() => {
    Gio.SettingsSchemaSource = realSchemaSource;
    vi.restoreAllMocks();
  });

  it("enable() connects the reconcile and session-mode handlers", () => {
    ext.enable();
    for (const signal of RECONCILE_SIGNALS) expect(settings.getHandlerCount(signal)).toBe(1);
    expect(Main.sessionMode.getHandlerCount("updated")).toBe(1);
    ext.disable();
  });

  it("disable() leaves no Forge handler on settings or sessionMode", () => {
    ext.enable();
    ext.disable();
    for (const signal of RECONCILE_SIGNALS) expect(settings.getHandlerCount(signal)).toBe(0);
    expect(Main.sessionMode.getHandlerCount("updated")).toBe(0);
  });

  it("ignores a session update after disable()", () => {
    ext.enable();
    ext.disable();
    // A "user" update would re-add the quick-settings indicator.
    Main.sessionMode.emit("updated", { currentMode: "user" });
    expect(ext.indicator).toBeNull();
  });

  it("drops the handlers before restoring the overrides", () => {
    ext.enable();
    const sessionOff = vi.spyOn(Main.sessionMode, "disconnectObject");
    const settingsOff = vi.spyOn(settings, "disconnectObject");
    const restore = vi.spyOn(settings, "set_string"); // the snapshot write
    ext.disable();
    expect(sessionOff).toHaveBeenCalledWith(ext);
    expect(settingsOff).toHaveBeenCalledWith(ext);
    const [sessionAt] = sessionOff.mock.invocationCallOrder;
    const [settingsAt] = settingsOff.mock.invocationCallOrder;
    const [restoreAt] = restore.mock.invocationCallOrder;
    expect(sessionAt).toBeLessThan(settingsAt);
    expect(settingsAt).toBeLessThan(restoreAt);
  });
});
