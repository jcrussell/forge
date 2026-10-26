import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { createWindowManagerFixture, createTiledWindow } from "../mocks/helpers/index.js";

/**
 * Feature #462: opening a window next to a maximized one unmaximizes it.
 * trackWindow calls handleUnmaximizeForTiling with the new window's node, which is
 * still FLOAT at that point (processFloats tiles it later), so the isFloat() guard
 * skipped every new window and the maximized one stayed over it.
 */
describe("Feature #462: a new window unmaximizes its maximized siblings", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "auto-unmaximize-for-tiling": true } });
  });

  afterEach(() => ctx.cleanup());

  it("unmaximizes a sibling when the new node is not tiled yet", () => {
    const { metaWindow: maxed } = createTiledWindow(ctx, { id: 9501 });
    maxed.maximize();
    const { nodeWindow: newNode } = createTiledWindow(ctx, { id: 9502 });
    newNode.mode = WINDOW_MODES.FLOAT; // as trackWindow creates it

    ctx.windowManager.handleUnmaximizeForTiling(newNode);

    expect(maxed.is_maximized()).toBe(false);
  });

  it("leaves the sibling maximized when the new window will float (a dialog)", () => {
    const { metaWindow: maxed } = createTiledWindow(ctx, { id: 9503 });
    maxed.maximize();
    const { nodeWindow: newNode } = createTiledWindow(ctx, { id: 9504 });
    newNode.mode = WINDOW_MODES.FLOAT;
    ctx.windowManager.isFloatingExempt = () => true;

    ctx.windowManager.handleUnmaximizeForTiling(newNode);

    expect(maxed.is_maximized()).toBe(true);
  });
});

describe("Feature #462: a maximized window counts as floating, and is still unmaximized", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "auto-unmaximize-for-tiling": true } });
  });

  afterEach(() => ctx.cleanup());

  it("unmaximizes a window floated only by its maximize (not resizable while maximized)", () => {
    const { metaWindow: maxed, nodeWindow: maxedNode } = createTiledWindow(ctx, { id: 9601 });
    maxed.maximize();
    maxedNode.mode = WINDOW_MODES.FLOAT; // processFloats: allows_resize() is false while maximized
    const { nodeWindow: newNode } = createTiledWindow(ctx, { id: 9602 });

    ctx.windowManager.handleUnmaximizeForTiling(newNode);

    expect(maxed.is_maximized()).toBe(false);
  });

  it("leaves a maximized window that floats by a rule alone", () => {
    const { metaWindow: maxed, nodeWindow: maxedNode } = createTiledWindow(ctx, { id: 9603 });
    maxed.maximize();
    maxedNode.mode = WINDOW_MODES.FLOAT;
    ctx.windowManager._matchesFloatOverride = (w) => w === maxed;
    const { nodeWindow: newNode } = createTiledWindow(ctx, { id: 9604 });

    ctx.windowManager.handleUnmaximizeForTiling(newNode);

    expect(maxed.is_maximized()).toBe(true);
  });
});
