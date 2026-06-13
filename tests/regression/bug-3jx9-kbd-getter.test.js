import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-3jx9 (P1): the extension constructs WindowManager BEFORE Keybindings, so
 * the constructor's `this._kbd = this.ext.keybindings` snapshotted `undefined`,
 * and `get kbd()` returned that frozen value forever. allowDragDropTile() —
 * `this.kbd.allowDragDropTile()` — therefore threw a TypeError on every tiled
 * drag, leaving the dragged node stuck in GRAB_TILE for the rest of the session.
 *
 * The fixture reproduces the construction order: keybindings is null at build
 * time (extension.js:112) and assigned afterwards (extension.js:113).
 */
describe("forge-3jx9: kbd getter resolves keybindings assigned after construction", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  it("kbd reflects keybindings assigned after the WindowManager was built", () => {
    expect(ctx.extension.keybindings).toBeNull(); // mirrors extension.js:112

    const keybindings = { allowDragDropTile: vi.fn(() => true) };
    ctx.extension.keybindings = keybindings; // mirrors extension.js:113

    expect(wm().kbd).toBe(keybindings);
  });

  it("allowDragDropTile() delegates to the live keybindings instead of throwing", () => {
    ctx.extension.keybindings = { allowDragDropTile: vi.fn(() => true) };

    expect(() => wm().allowDragDropTile()).not.toThrow();
    expect(wm().allowDragDropTile()).toBe(true);
  });
});
