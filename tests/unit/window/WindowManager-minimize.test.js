import { describe, it, expect, beforeEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Rectangle } from "../../mocks/gnome/Meta.js";
import { Bin } from "../../mocks/gnome/St.js";

/**
 * forge-4yl: the minimize and unminimize signal handlers shared near-identical
 * logic (find the focused node, reset its parent's sibling percents, re-render).
 * They were consolidated into _onMinimizeChange(reason, opts). These tests pin
 * the exact behavior so the refactor stays behavior-preserving:
 *  - both reset the focused node's parent percents and render with their reason
 *  - minimize additionally hides borders and, when the parent has no tiled
 *    children left, resets the grandparent's percents
 *  - unminimize does neither of those extras
 */
describe("WindowManager - minimize/unminimize (_onMinimizeChange)", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;

  // monitor (grandparent) -> CON parent (HSPLIT) -> windows
  function buildParentWithWindows(count) {
    const { monitor: grandparent } = getWorkspaceAndMonitor(ctx);
    const parent = ctx.tree.createNode(grandparent.nodeValue, NODE_TYPES.CON, new Bin());
    parent.layout = LAYOUT_TYPES.HSPLIT;
    const windows = [];
    for (let i = 0; i < count; i++) {
      const meta = createMockWindow({
        rect: new Rectangle({ x: 0, y: 0, width: 960, height: 1080 }),
        workspace: ctx.workspaces[0],
      });
      const node = ctx.tree.createNode(parent.nodeValue, NODE_TYPES.WINDOW, meta);
      windows.push(node);
    }
    return { grandparent, parent, windows };
  }

  function focusOn(metaWindow) {
    global.display.get_focus_window.mockReturnValue(metaWindow);
  }

  it("minimize resets the parent percents, hides borders, and renders with 'minimize'", () => {
    const { parent, windows } = buildParentWithWindows(2);
    // Minimize the focused window; a tiled sibling remains under the parent.
    windows[0].nodeValue.minimized = true;
    focusOn(windows[0].nodeValue);

    const resetSpy = vi.spyOn(ctx.tree, "resetSiblingPercent");
    const hideSpy = vi.spyOn(wm(), "hideWindowBorders");
    const renderSpy = vi.spyOn(wm(), "_renderWithFreezeState").mockImplementation(() => {});

    wm()._onMinimizeChange("minimize", { hideBorders: true, resetGrandparentIfEmpty: true });

    expect(hideSpy).toHaveBeenCalled();
    expect(resetSpy).toHaveBeenCalledWith(parent);
    expect(renderSpy).toHaveBeenCalledWith("minimize");
  });

  it("minimize resets the grandparent when the parent has no tiled children left", () => {
    const { grandparent, parent, windows } = buildParentWithWindows(1);
    // The only window is now minimized -> getTiledChildren(parent) is empty.
    windows[0].nodeValue.minimized = true;
    focusOn(windows[0].nodeValue);

    const resetSpy = vi.spyOn(ctx.tree, "resetSiblingPercent");

    wm()._onMinimizeChange("minimize", { hideBorders: true, resetGrandparentIfEmpty: true });

    expect(resetSpy).toHaveBeenCalledWith(grandparent);
    expect(resetSpy).toHaveBeenCalledWith(parent);
  });

  it("unminimize resets the parent percents and renders without hiding borders", () => {
    const { parent, windows } = buildParentWithWindows(2);
    focusOn(windows[0].nodeValue);

    const resetSpy = vi.spyOn(ctx.tree, "resetSiblingPercent");
    const hideSpy = vi.spyOn(wm(), "hideWindowBorders");
    const renderSpy = vi.spyOn(wm(), "_renderWithFreezeState").mockImplementation(() => {});

    wm()._onMinimizeChange("unminimize");

    expect(hideSpy).not.toHaveBeenCalled();
    expect(resetSpy).toHaveBeenCalledWith(parent);
    expect(resetSpy).not.toHaveBeenCalledWith(parent.parentNode);
    expect(renderSpy).toHaveBeenCalledWith("unminimize");
  });

  it("is a no-op (only renders) when there is no focused node", () => {
    focusOn(null);
    const resetSpy = vi.spyOn(ctx.tree, "resetSiblingPercent");
    const renderSpy = vi.spyOn(wm(), "_renderWithFreezeState").mockImplementation(() => {});

    wm()._onMinimizeChange("minimize", { hideBorders: true, resetGrandparentIfEmpty: true });

    expect(resetSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledWith("minimize");
  });
});
