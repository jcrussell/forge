import { describe, it, expect, beforeEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Rectangle } from "../mocks/gnome/Meta.js";

/**
 * Bug #530 regression: move() called windowActor.remove_all_transitions()
 * unconditionally. Forge itself never adds window-actor transitions, so the
 * only effect on a freshly created window was to strip the map/open effect
 * (GNOME Shell's own or an animation extension's like Burn My Windows) when
 * the first tiling placement landed. The first placement of a new window
 * (metaWindow.firstRender, set in trackWindow) must leave transitions alone.
 */
describe("Bug #530: first placement preserves the window-open animation", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;
  const rect = { x: 0, y: 0, width: 960, height: 1080 };

  function newTrackedWindow() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const meta = createMockWindow({
      rect: new Rectangle(rect),
      workspace: ctx.workspaces[0],
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, meta);
    node.mode = WINDOW_MODES.TILE;
    return { meta, node };
  }

  it("first move of a freshly created window preserves actor transitions", () => {
    const { meta } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    meta.firstRender = true;
    wm().move(meta, rect);

    expect(spy).not.toHaveBeenCalled();
  });

  it("subsequent moves strip transitions as before", () => {
    const { meta } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    wm().move(meta, rect);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the skip is one-shot even when the window is never tiled by render", () => {
    // A permanently floating window never goes through tree.apply(), which is
    // where firstRender is otherwise cleared - move() must consume the flag
    // itself so only the FIRST placement skips the strip.
    const { meta } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    meta.firstRender = true;
    wm().move(meta, rect);
    wm().move(meta, rect);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("render path: first render preserves transitions, second render strips", () => {
    const { meta } = newTrackedWindow();
    const spy = vi.spyOn(meta.get_compositor_private(), "remove_all_transitions");

    meta.firstRender = true;
    ctx.tree.render("test-first");
    expect(spy).not.toHaveBeenCalled();

    ctx.tree.render("test-second");
    expect(spy).toHaveBeenCalled();
  });
});
