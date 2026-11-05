import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../../lib/shared/settings.js";
import { File } from "../mocks/gnome/Gio.js";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-45tv: ConfigManager.windowProps only checked that `overrides` is an
 * array, never its entries. A hand-edited windows.json with a null entry, an
 * array wmClass or a number wmTitle made the override matchers throw (null
 * deref, .split on a non-string) from processFloats, aborting every render.
 * The getter now drops such entries, so every matcher sees well-formed rules.
 */
describe("forge-45tv: malformed windows.json override entries are dropped", () => {
  const good = { wmClass: "Firefox", wmTitle: "Picture-in-Picture", mode: "float" };
  const malformed = [
    null,
    "Firefox",
    ["Firefox"],
    { wmClass: ["Firefox"], mode: "float" },
    { wmClass: "Firefox", wmTitle: 42, mode: "float" },
  ];

  let configManager;
  let ctx;

  beforeEach(() => {
    configManager = new ConfigManager({ dir: { get_path: () => "/test/extension/path" } });
    const file = new File("/config/windows.json");
    const encoded = new TextEncoder().encode(
      JSON.stringify({ overrides: [...malformed, good], extra: 1 })
    );
    file.load_contents = () => [true, encoded, null];
    Object.defineProperty(configManager, "windowConfigFile", {
      get: () => file,
      configurable: true,
    });
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("keeps only the well-formed entries and the other top-level keys", () => {
    expect(configManager.windowProps).toEqual({ overrides: [good], extra: 1 });
  });

  it("isFloatingExempt matches on the sanitised rules without throwing", () => {
    ctx.windowManager.windowProps = configManager.windowProps;
    const pip = createMockWindow({ wm_class: "Firefox", title: "Picture-in-Picture" });
    const other = createMockWindow({ wm_class: "Firefox", title: "Mozilla Firefox" });

    expect(ctx.windowManager.isFloatingExempt(pip)).toBe(true);
    expect(ctx.windowManager.isFloatingExempt(other)).toBe(false);
  });
});
