import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Firefox's Picture-in-Picture window has no class of its own and a localized
 * title, and on Wayland it is an ordinary window. The bundled rules float any
 * window of a Firefox class whose title lacks the brand name, so they must name
 * the class each official build reports: release `firefox`, Fedora and Flatpak
 * `org.mozilla.firefox`, ESR `firefox-esr`, beta `firefox-beta`.
 */
const BUNDLED = JSON.parse(
  readFileSync(resolve(__dirname, "../../config/windows.json"), "utf8")
).overrides;

describe("bundled rules float Firefox's Picture-in-Picture window in any language", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    ctx.windowManager.windowProps = { overrides: structuredClone(BUNDLED) };
  });

  afterEach(() => ctx.cleanup());

  const floats = (wm_class, title) =>
    ctx.windowManager.isFloatingExempt(createMockWindow({ wm_class, title, allows_resize: true }));

  it.each(["firefox", "org.mozilla.firefox", "firefox-esr", "firefox-beta"])(
    "%s: floats a German PiP window and tiles the main window",
    (wmClass) => {
      expect(floats(wmClass, "Bild-im-Bild")).toBe(true);
      expect(floats(wmClass, "Startseite — Mozilla Firefox")).toBe(false);
      expect(floats(wmClass, "Mozilla Firefox Private Browsing")).toBe(false);
    }
  );

  it.each(["firefox-nightly", "firefox-dev"])(
    "%s: tiles the main window, whose title carries another brand name",
    (wmClass) => {
      expect(floats(wmClass, "Start — Firefox Nightly")).toBe(false);
      expect(floats(wmClass, "Picture-in-Picture")).toBe(true);
    }
  );
});
