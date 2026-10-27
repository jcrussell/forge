import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-ext/forge#514: WPS's drop-down menus and Zotero's notifications are
 * ordinary windows to GNOME, so Forge tiled them as large windows next to the
 * document. They keep themselves off the taskbar, as popups and drop-down
 * terminals do and windows to work in never do: such a window floats.
 */
describe("#514: a window kept off the taskbar floats", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const app = (params = {}) =>
    createMockWindow({
      wm_class: "wps",
      id: 2001,
      title: "Document",
      allows_resize: true,
      ...params,
    });

  it("floats a popup that skips the taskbar", () => {
    expect(ctx.windowManager.isFloatingExempt(app({ skip_taskbar: true }))).toBe(true);
  });

  it("still tiles the app's own window", () => {
    expect(ctx.windowManager.isFloatingExempt(app())).toBe(false);
  });
});
