import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createHorizontalLayout,
} from "../mocks/helpers/index.js";

/**
 * Bug #461 (forge-9yo): Window can be edge-snapped/maximized while tiled.
 *
 * Problem: GNOME's native edge-snap (super+Left/Right) or maximize (super+Up) on a
 * tiled window changes its geometry. `size-changed` fires -> updateMetaPositionSize(),
 * but the re-tile is gated on `Compat.isNotMaximized(focusMetaWindow)` (window.js).
 * A natively-maximized window fails that guard, so renderTree is skipped and the window
 * stays snapped/maximized, desynced from its tiled tree slot.
 *
 * Fix: when the *changed* window is a TILE window that was externally maximized/snapped
 * (any direction) AND it is not the sole tiled window on its monitor (so the legitimate
 * window-maximize-on-single case is preserved), unmaximize it and re-tile.
 *
 * Note: native edge-snap maximizes only one axis, so the BOTH-only `isNotMaximized`
 * helper does not catch it — the reject check must look at any maximize direction.
 */
describe("Bug #461: reject external maximize/edge-snap on a tiled window", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "tiling-mode-enabled": true,
        "window-maximize-on-single": true,
      },
    });
    // updateMetaPositionSize ends by updating borders/decorations — stub the UI bits.
    vi.spyOn(ctx.windowManager, "updateBorderLayout").mockImplementation(() => {});
    vi.spyOn(ctx.windowManager, "updateDecorationLayout").mockImplementation(() => {});
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const wm = () => ctx.windowManager;

  it("unmaximizes a fully-maximized tiled window that has tiled siblings", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const [first, second] = createHorizontalLayout(ctx.tree, monitor, 2);

    const maxed = first.metaWindow;
    maxed.maximize(); // both axes -> is_maximized() true
    ctx.display.get_focus_window.mockReturnValue(maxed);

    const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm().updateMetaPositionSize(maxed, "size-changed");

    expect(maxed.is_maximized()).toBe(false); // Compat.unmaximize was applied
    expect(renderSpy).toHaveBeenCalled();
  });

  it("unmaximizes an edge-snapped (single-axis) tiled window that has tiled siblings", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const [first, second] = createHorizontalLayout(ctx.tree, monitor, 2);

    const snapped = first.metaWindow;
    // Half-tiling sets a single maximize axis (is_maximized() stays false).
    snapped.maximized_vertically = true;
    ctx.display.get_focus_window.mockReturnValue(snapped);

    const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm().updateMetaPositionSize(snapped, "size-changed");

    expect(snapped.maximized_vertically).toBe(false); // unmaximized
    expect(renderSpy).toHaveBeenCalled();
  });

  it("does NOT unmaximize the sole tiled window on a monitor (maximize-on-single)", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const [only] = createHorizontalLayout(ctx.tree, monitor, 1);

    const maxed = only.metaWindow;
    maxed.maximize();
    ctx.display.get_focus_window.mockReturnValue(maxed);

    vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm().updateMetaPositionSize(maxed, "size-changed");

    expect(maxed.is_maximized()).toBe(true); // left alone -> no unmaximize/render loop
  });

  it("does NOT touch a fullscreen tiled window", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const [first, second] = createHorizontalLayout(ctx.tree, monitor, 2);

    const fs = first.metaWindow;
    fs.make_fullscreen();
    fs.maximize();
    ctx.display.get_focus_window.mockReturnValue(fs);

    vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm().updateMetaPositionSize(fs, "size-changed");

    expect(fs.is_maximized()).toBe(true); // fullscreen is exempt
  });
});
