import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug #78: windows must not detach from the tree on transient monitor loss
 * (KVM switch, lock). The "workareas-changed" handler guards on monitor count
 * being zero; this test exercises that guard via the extracted named handler.
 */
describe("Bug #78: workareas-changed monitor-count guard", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  // A tracked window so that getNodeByType("WINDOW").length > 0 — without it the
  // guard assertion would be vacuous (the handler skips rendering on an empty tree).
  function addTrackedWindow() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
    return ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
  }

  it("does nothing when no monitors are present, even with windows in the tree", () => {
    addTrackedWindow();
    ctx.display.get_n_monitors = vi.fn(() => 0);
    const render = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    const track = vi.spyOn(wm(), "trackCurrentWindows").mockImplementation(() => {});

    wm()._onWorkareasChanged(ctx.display);

    expect(render).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("re-renders the tree on a normal workareas change", () => {
    addTrackedWindow();
    ctx.display.get_n_monitors = vi.fn(() => 1);
    const render = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    const track = vi.spyOn(wm(), "trackCurrentWindows").mockImplementation(() => {});
    wm().workspaceAdded = false;
    wm().workspaceRemoved = false;

    wm()._onWorkareasChanged(ctx.display);

    expect(render).toHaveBeenCalledWith("workareas-changed");
    expect(track).not.toHaveBeenCalled();
  });

  it("re-tracks windows (not just re-render) after a workspace add/remove", () => {
    addTrackedWindow();
    ctx.display.get_n_monitors = vi.fn(() => 1);
    const render = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
    const track = vi.spyOn(wm(), "trackCurrentWindows").mockImplementation(() => {});
    wm().workspaceAdded = true;

    wm()._onWorkareasChanged(ctx.display);

    expect(track).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    expect(wm().workspaceAdded).toBe(false);
    expect(wm().workspaceRemoved).toBe(false);
  });
});
