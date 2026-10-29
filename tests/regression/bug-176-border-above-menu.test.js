import { describe, it, expect, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-ext/forge#176: GNOME restacks the window actors when a window or menu
 * opens or is raised, which could leave the focus border over the focused
 * window's menu. On "restacked" the borders go back just above the window.
 */
describe("Bug #176: focus border stays below the focused window's menus", () => {
  let ctx;

  afterEach(() => ctx.cleanup());

  it("puts the borders back just above the focused window", () => {
    ctx = createWindowManagerFixture();
    const win = createMockWindow({ id: 1 });
    const actor = win.get_compositor_private();
    const menu = { name: "menu" };
    actor.border = { name: "border" };
    actor.splitBorder = { name: "split" };
    // GNOME's restack put the menu between the window and its borders
    [actor, menu, actor.border, actor.splitBorder].forEach((a) => global.window_group.add_child(a));
    ctx.display.get_focus_window.mockReturnValue(win);

    ctx.windowManager._restackBorders();

    const ours = [actor, menu, actor.border, actor.splitBorder];
    const order = global.window_group.get_children().filter((a) => ours.includes(a));
    expect(order).toEqual([actor, actor.border, actor.splitBorder, menu]);
  });
});
