import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";
import { Rectangle, WindowType } from "../mocks/gnome/Meta.js";

/**
 * forge-ext/forge#454: with focus on hover, moving the pointer over an open
 * menu focused the window under the menu, which closed the menu.
 */
describe("Bug #454: focus on hover leaves open menus alone", () => {
  let ctx;
  const POINTER = [100, 100];
  const covering = () => new Rectangle({ x: 0, y: 0, width: 400, height: 400 });

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("finds no window to focus when the pointer is over a menu", () => {
    const app = createMockWindow({ id: 1, rect: covering(), workspace: ctx.workspaces[0] });
    const menu = createMockWindow({
      id: 2,
      rect: covering(),
      workspace: ctx.workspaces[0],
      window_type: WindowType.POPUP_MENU,
    });
    global.get_window_actors.mockReturnValue([app, menu].map((meta_window) => ({ meta_window })));

    expect(ctx.windowManager._getMetaWindowAtPointer(POINTER)).toBe(null);
  });

  it("finds the window when no menu is over it", () => {
    const app = createMockWindow({ id: 1, rect: covering(), workspace: ctx.workspaces[0] });
    global.get_window_actors.mockReturnValue([{ meta_window: app }]);

    expect(ctx.windowManager._getMetaWindowAtPointer(POINTER)).toBe(app);
  });
});
