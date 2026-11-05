import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WindowType } from "../mocks/gnome/Meta.js";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-e85 (#109): Forge checked a window's type only when tracking it.
 * Desktop Icons NG maps a NORMAL toplevel, which Forge tracks, then retypes it
 * DESKTOP (meta_window_set_type, notify::window-type), so the desktop window
 * stayed in the tree and could be tiled and focused.
 *
 * Fix: a notify::window-type handler untracks a window that is no longer
 * valid, through the closed-window path, and releases its signals.
 */
describe("forge-e85: a window retyped to DESKTOP leaves the tree", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const track = (overrides = {}) => {
    const win = createMockWindow({
      wm_class: "gjs",
      title: "Desktop Icons 1",
      allows_resize: true,
      workspace: ctx.workspaces[0],
      ...overrides,
    });
    ctx.windowManager.trackWindow(null, win);
    expect(ctx.tree.findNode(win)).toBeTruthy();
    return win;
  };

  it("untracks the window and disconnects its signals", () => {
    const win = track();
    const actor = win.get_compositor_private();

    win.set_window_type(WindowType.DESKTOP);

    expect(ctx.tree.findNode(win)).toBeFalsy();
    expect(win.windowSignals).toBeUndefined();
    expect(actor.actorSignals).toBeUndefined();
    expect(actor.border).toBeUndefined();
  });

  it("drops the always-on-top pin Forge set on the window", () => {
    ctx.cleanup();
    ctx = createWindowManagerFixture({ settings: { "float-always-on-top-enabled": true } });
    // Class-less at map time, so Forge floats and pins it.
    const win = track({ wm_class: null });
    ctx.windowManager.processFloats();
    expect(win.is_above()).toBe(true);

    win.set_window_type(WindowType.DESKTOP);

    expect(ctx.tree.findNode(win)).toBeFalsy();
    expect(win.is_above()).toBe(false);
  });

  it("keeps a user's always-on-top pin", () => {
    const win = track();
    win.make_above();

    win.set_window_type(WindowType.DESKTOP);

    expect(win.is_above()).toBe(true);
  });

  it("keeps a window whose new type is still valid and re-renders it", () => {
    const win = track({ wm_class: "App", title: "Editor" });
    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree");

    win.set_window_type(WindowType.MODAL_DIALOG);

    expect(ctx.tree.findNode(win)).toBeTruthy();
    expect(renderSpy).toHaveBeenCalledWith("window-type-changed");
  });
});
