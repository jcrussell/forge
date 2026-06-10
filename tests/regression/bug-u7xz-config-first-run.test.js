import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConfigManager } from "../../lib/shared/settings.js";
import { File } from "../mocks/gnome/Gio.js";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-u7xz: two config robustness gaps.
 *
 * (1) ConfigManager.loadFile()'s first-run seeding branch was entirely
 * unguarded, unlike its counterpart _saveJsonConfig: make_directory_with_parents
 * and create() throw GErrors on failure (they don't return false in GJS),
 * and loadFileContents(null) / write_all(undefined) throw when the bundled
 * default is missing or unreadable. This runs from the windowProps getter, so
 * a fresh-profile failure crashed override loading.
 *
 * (2) _updateWindowOverrides persisted windows.json unconditionally —
 * windowDestroy calls the remove path on EVERY window close, rewriting the
 * file even when no override matched.
 */
describe("forge-u7xz: ConfigManager.loadFile first-run robustness", () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigManager({ dir: new File("/mock/extension") });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // loadFile resolves the custom file first, then the profile dir. Shape both.
  function mockFileResolution({ dirBehavior }) {
    let callCount = 0;
    vi.spyOn(File, "new_for_path").mockImplementation((path) => {
      callCount++;
      const file = new File(path);
      file.query_exists = vi.fn(() => false);
      if (callCount === 2) dirBehavior(file);
      return file;
    });
  }

  it("does not throw when directory creation throws (GError, not false)", () => {
    mockFileResolution({
      dirBehavior: (dir) => {
        dir.make_directory_with_parents = vi.fn(() => {
          throw new Error("GError: Permission denied");
        });
      },
    });

    expect(() => configManager.loadFile("/custom", "windows.json", null)).not.toThrow();
    expect(configManager.loadFile("/custom", "windows.json", null)).toBeNull();
  });

  it("does not throw when the bundled default file is missing (null)", () => {
    mockFileResolution({ dirBehavior: () => {} });

    // Pre-fix: loadFileContents(null) threw a TypeError, and an empty profile
    // file had already been created before the contents were read.
    expect(() => configManager.loadFile("/custom", "windows.json", null)).not.toThrow();
  });

  it("does not throw when file creation races another process", () => {
    let created = null;
    let callCount = 0;
    vi.spyOn(File, "new_for_path").mockImplementation((path) => {
      callCount++;
      const file = new File(path);
      file.query_exists = vi.fn(() => false);
      if (callCount === 1) {
        file.create = vi.fn(() => {
          throw new Error("GError: File exists");
        });
        created = file;
      }
      return file;
    });
    const defaultFile = new File("/default/windows.json");

    expect(() => configManager.loadFile("/custom", "windows.json", defaultFile)).not.toThrow();
    expect(created.create).toHaveBeenCalled();
  });
});

describe("forge-u7xz: no-op override updates do not rewrite windows.json", () => {
  let ctx;
  let writeCount;
  let props;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    writeCount = 0;
    props = { overrides: [] };
    Object.defineProperty(ctx.configMgr, "windowProps", {
      get: () => props,
      set: (value) => {
        writeCount++;
        props = value;
      },
      configurable: true,
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("skips the write when removing an override that does not exist", () => {
    const win = createMockWindow({ wm_class: "App" });

    // The windowDestroy path: remove a per-window float override on close.
    ctx.windowManager.removeFloatOverride(win, true);

    expect(writeCount).toBe(0);
  });

  it("still writes when an override is actually added and removed", () => {
    const win = createMockWindow({ wm_class: "App" });

    ctx.windowManager.addFloatOverride(win, true);
    expect(writeCount).toBe(1);
    expect(props.overrides).toHaveLength(1);

    ctx.windowManager.removeFloatOverride(win, true);
    expect(writeCount).toBe(2);
    expect(props.overrides).toHaveLength(0);
  });

  it("skips the write when adding a duplicate override", () => {
    const win = createMockWindow({ wm_class: "App" });

    ctx.windowManager.addFloatOverride(win, true);
    ctx.windowManager.addFloatOverride(win, true);

    expect(writeCount).toBe(1);
    expect(props.overrides).toHaveLength(1);
  });
});
