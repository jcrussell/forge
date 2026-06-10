import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import * as Meta from "../mocks/gnome/Meta.js";
import * as St from "../mocks/gnome/St.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * forge-wsc (#351) / forge-05l (#454) regression: renderTree fires on every
 * tracked-window focus change (and workspace events), and tree.apply() calls
 * move() on EVERY tiled window each pass. move() unconditionally ran
 * unmaximize + remove_all_transitions + move_frame + move_resize_frame even
 * when the window was already exactly in place, stripping in-flight shell
 * animations and re-asserting identical geometry on every render. move() must
 * skip windows that are already at their (constraint-adjusted) target rect.
 */
describe("Bug #351/#454: move() skips windows already in place", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    Meta.__setWayland(false);
    St.__setScaleFactor(1);
  });

  const wm = () => ctx.windowManager;

  function trackedWindow(params = {}) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const meta = createMockWindow({ workspace: ctx.workspaces[0], ...params });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta);
    node.mode = WINDOW_MODES.TILE;
    return { meta, node };
  }

  function spyMoveCalls(meta) {
    return {
      moveResize: vi.spyOn(meta, "move_resize_frame"),
      moveFrame: vi.spyOn(meta, "move_frame"),
      stripTransitions: vi.spyOn(meta.get_compositor_private(), "remove_all_transitions"),
      unmaximize: vi.spyOn(meta, "unmaximize"),
    };
  }

  it("skips all side effects when the target rect equals the current frame", () => {
    const rect = { x: 10, y: 20, width: 800, height: 600 };
    const { meta } = trackedWindow({ rect: new Rectangle(rect) });
    const spies = spyMoveCalls(meta);

    wm().move(meta, rect);

    expect(spies.moveResize).not.toHaveBeenCalled();
    expect(spies.moveFrame).not.toHaveBeenCalled();
    expect(spies.stripTransitions).not.toHaveBeenCalled();
    expect(spies.unmaximize).not.toHaveBeenCalled();
  });

  it("still moves when the target rect differs", () => {
    const { meta } = trackedWindow({
      rect: new Rectangle({ x: 0, y: 0, width: 800, height: 600 }),
    });
    const spies = spyMoveCalls(meta);

    wm().move(meta, { x: 0, y: 0, width: 960, height: 540 });

    expect(spies.moveResize).toHaveBeenCalledWith(true, 0, 0, 960, 540);
  });

  it("a maximized window at the target rect is still unmaximized and moved", () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const { meta } = trackedWindow({
      rect: new Rectangle(rect),
      maximized_horizontally: true,
      maximized_vertically: true,
    });
    const spies = spyMoveCalls(meta);

    wm().move(meta, rect);

    expect(spies.unmaximize).toHaveBeenCalled();
    expect(spies.moveResize).toHaveBeenCalled();
  });

  it("a single-axis-maximized window at the target rect is still unmaximized", () => {
    const rect = { x: 0, y: 0, width: 960, height: 1080 };
    const { meta } = trackedWindow({
      rect: new Rectangle(rect),
      maximized_vertically: true,
    });
    const spies = spyMoveCalls(meta);

    wm().move(meta, rect);

    expect(spies.unmaximize).toHaveBeenCalled();
  });

  it("skips when a min-size-constrained window already sits at its clamped size", () => {
    // Mutter never shrinks below min size, so the settled frame keeps
    // min_width even though the slot is narrower; that frame is "in place".
    const { meta } = trackedWindow({
      rect: new Rectangle({ x: 100, y: 0, width: 1010, height: 600 }),
      size_hints: { min_width: 1010, min_height: 200 },
    });
    const spies = spyMoveCalls(meta);

    wm().move(meta, { x: 100, y: 0, width: 960, height: 600 });

    expect(spies.moveResize).not.toHaveBeenCalled();
    expect(spies.stripTransitions).not.toHaveBeenCalled();
  });

  it("render path: a second render of an unchanged layout moves nothing", () => {
    const { meta: metaA } = trackedWindow();
    const { meta: metaB } = trackedWindow();

    ctx.tree.render("first");
    const spyA = vi.spyOn(metaA, "move_resize_frame");
    const spyB = vi.spyOn(metaB, "move_resize_frame");

    ctx.tree.render("second");

    expect(spyA).not.toHaveBeenCalled();
    expect(spyB).not.toHaveBeenCalled();
  });

  it("Wayland HiDPI: compares the buffer-scale-adjusted rect, not the raw target", () => {
    Meta.__setWayland(true);
    St.__setScaleFactor(2);
    // Odd target rect aligns to even values; the settled frame holds the
    // aligned rect, so a re-render with the same odd target must skip.
    const { meta } = trackedWindow({
      rect: new Rectangle({ x: 102, y: 52, width: 960, height: 540 }),
    });
    const spies = spyMoveCalls(meta);

    wm().move(meta, { x: 101, y: 51, width: 959, height: 539 });

    expect(spies.moveResize).not.toHaveBeenCalled();
  });
});
