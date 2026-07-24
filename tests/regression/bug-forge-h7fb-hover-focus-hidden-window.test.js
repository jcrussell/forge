import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-h7fb (audit-2026-07b): _getMetaWindowAtPointer() walks
 * global.get_window_actors() top-of-stack downward and returns the first window
 * whose get_frame_rect() contains the pointer, filtering only on window TYPE.
 *
 * That list is display-wide, and neither minimized windows nor windows on other
 * workspaces lose their frame rect or their stacking slot. So a hidden window
 * sitting above the real hover target shadowed it: _focusWindowUnderPointer()
 * focused the invisible window and returned, and focus-on-hover was dead across
 * that whole region until something else got raised above it. The 300ms
 * _workspaceChanging band-aid (bug #374) was papering over the workspace half of
 * exactly this.
 *
 * Fix: skip windows that aren't actually visible right now — minimized, or not
 * located on the active workspace — guarded by Utils.isWindowAlive, because this
 * runs inside a 16ms GLib.timeout_add whose source is removed if the callback
 * throws (decoration.js/forge-e5mh documents these accessors throwing on a
 * finalized wrapper).
 */
describe("Bug forge-h7fb: focus-on-hover must skip windows the user cannot see", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;
  const POINTER = [500, 500];
  const covering = () => new Rectangle({ x: 0, y: 0, width: 1920, height: 1080 });

  /** Stack actors bottom-to-top, matching global.get_window_actors() order. */
  function stack(...metaWindows) {
    global.get_window_actors.mockReturnValue(metaWindows.map((meta_window) => ({ meta_window })));
  }

  it("skips a minimized window stacked above the visible one", () => {
    const visible = createMockWindow({
      id: 1,
      rect: covering(),
      workspace: ctx.workspaces[0],
    });
    const hidden = createMockWindow({
      id: 2,
      rect: covering(),
      workspace: ctx.workspaces[0],
    });
    hidden.minimized = true;

    stack(visible, hidden);

    expect(wm()._getMetaWindowAtPointer(POINTER)).toBe(visible);
  });

  it("skips a window on another workspace stacked above the visible one", () => {
    const visible = createMockWindow({
      id: 1,
      rect: covering(),
      workspace: ctx.workspaces[0],
    });
    const offWorkspace = createMockWindow({
      id: 2,
      rect: covering(),
      workspace: ctx.workspaces[1],
    });

    // Not minimized: showing_on_its_workspace() is true for it, which is exactly
    // why the workspace-membership test is the load-bearing one here.
    expect(offWorkspace.showing_on_its_workspace()).toBe(true);

    stack(visible, offWorkspace);

    expect(wm()._getMetaWindowAtPointer(POINTER)).toBe(visible);
  });

  it("still returns a sticky (on-all-workspaces) window", () => {
    const sticky = createMockWindow({
      id: 1,
      rect: covering(),
      workspace: ctx.workspaces[1],
    });
    sticky.stick();

    stack(sticky);

    expect(wm()._getMetaWindowAtPointer(POINTER)).toBe(sticky);
  });

  it("does not throw when an actor's wrapper has been finalized", () => {
    const dead = createMockWindow({ id: 1, rect: covering(), workspace: ctx.workspaces[0] });
    // A finalized wrapper throws on EVERY accessor, including the get_id()
    // probe Utils.isWindowAlive uses.
    const finalize = () => {
      throw new Error("Object .Meta.Window (0x0), has been already finalized.");
    };
    dead.get_id = finalize;
    dead.get_frame_rect = finalize;
    dead.get_window_type = finalize;

    const visible = createMockWindow({ id: 2, rect: covering(), workspace: ctx.workspaces[0] });

    stack(visible, dead);

    expect(() => wm()._getMetaWindowAtPointer(POINTER)).not.toThrow();
    expect(wm()._getMetaWindowAtPointer(POINTER)).toBe(visible);
  });

  it("still returns the topmost visible window under the pointer", () => {
    const below = createMockWindow({ id: 1, rect: covering(), workspace: ctx.workspaces[0] });
    const above = createMockWindow({ id: 2, rect: covering(), workspace: ctx.workspaces[0] });

    stack(below, above);

    expect(wm()._getMetaWindowAtPointer(POINTER)).toBe(above);
  });

  it("returns null when the pointer is outside every window", () => {
    const win = createMockWindow({
      id: 1,
      rect: new Rectangle({ x: 0, y: 0, width: 100, height: 100 }),
      workspace: ctx.workspaces[0],
    });

    stack(win);

    expect(wm()._getMetaWindowAtPointer(POINTER)).toBeNull();
  });

  it("hover-focus reaches the visible window instead of stopping at the hidden one", () => {
    const visible = createMockWindow({ id: 1, rect: covering(), workspace: ctx.workspaces[0] });
    const hidden = createMockWindow({ id: 2, rect: covering(), workspace: ctx.workspaces[0] });
    hidden.minimized = true;
    visible.focus = vi.fn();
    hidden.focus = vi.fn();

    stack(visible, hidden);
    global.get_pointer = vi.fn(() => POINTER);
    wm().shouldFocusOnHover = true;
    wm().disabled = false;
    global.Main.overview.visible = false;

    wm()._focusWindowUnderPointer();

    expect(hidden.focus).not.toHaveBeenCalled();
    expect(visible.focus).toHaveBeenCalled();
  });
});
