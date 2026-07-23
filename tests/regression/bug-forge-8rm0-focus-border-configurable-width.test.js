import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-8rm0 (audit-2026-07 / C16): showWindowBorders() positioned the focus
 * border actor with a hardcoded inset of 3px (* dpi), assuming the default
 * border-width. But border-width is user-configurable via prefs (written to the CSS
 * stylesheet), so a wider ring overlapped window content and a narrower one left a
 * gap. The inset must follow the configured width.
 *
 * Fix: read the actual painted border-width from the border actor's themed node
 * (like tree.js _applyDecorationRect), falling back to 3px when none is themed.
 */
describe("Bug forge-8rm0: focus-border inset follows the configured border-width", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "focus-border-toggle": true,
        "focus-border-hidden-on-single": false,
        "split-border-toggle": false,
        "window-gap-size": 4,
        "tiling-mode-enabled": true,
      },
    });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("insets the border by the themed border-width (8px), not the hardcoded 3px", () => {
    const metaWindow = createMockWindow({
      rect: new Rectangle({ x: 100, y: 100, width: 800, height: 600 }),
      workspace: ctx.workspaces[0],
      wm_class: "TestApp",
    });

    const mockBorder = {
      set_style_class_name: vi.fn(),
      add_style_class_name: vi.fn(),
      set_size: vi.fn(),
      set_position: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      // Configured (user) border-width of 8 physical px.
      get_theme_node: () => ({ get_border_width: () => 8 }),
    };
    metaWindow.get_compositor_private().border = mockBorder;

    global.display.get_focus_window.mockReturnValue(metaWindow);

    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const n1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    n1.mode = WINDOW_MODES.TILE;
    // Second window so the single-window skip doesn't apply.
    const m2 = createMockWindow({
      rect: new Rectangle({ x: 900, y: 100, width: 800, height: 600 }),
      workspace: ctx.workspaces[0],
    });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, m2).mode = WINDOW_MODES.TILE;

    ctx.windowManager.showWindowBorders();

    // rect = frame_rect (100,100). inset must be 8 -> position (92, 92), size 800+16.
    expect(mockBorder.set_position).toHaveBeenCalledWith(92, 92);
    expect(mockBorder.set_size).toHaveBeenCalledWith(816, 616);
  });
});
