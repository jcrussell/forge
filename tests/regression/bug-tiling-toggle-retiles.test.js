import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Turning tiling back on (the "Tiling" quick setting or its shortcut) only
 * re-rendered the existing tree, so windows that had ended up in the wrong place
 * stayed there. It now rebuilds the tree, keeping the layout, and lays out every
 * window again: toggling tiling off and on puts them back.
 */
describe("turning tiling back on retiles every window", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
  });

  afterEach(() => ctx.cleanup());

  it("rebuilds the tree, keeping the layout, when tiling is turned on", () => {
    const reloadSpy = vi.spyOn(wm(), "reloadTree");
    const snapshotSpy = vi.spyOn(wm().tree, "snapshotFullLayout");
    const restoreSpy = vi.spyOn(wm().tree, "restoreFullLayout");

    wm()._onSettingsChanged("tiling-mode-enabled");

    expect(reloadSpy).toHaveBeenCalledWith("tiling-on");
    expect(snapshotSpy).toHaveBeenCalled();
    expect(restoreSpy).toHaveBeenCalledWith(snapshotSpy.mock.results[0].value);
  });

  it("only re-renders when tiling is turned off", () => {
    ctx.settings.set_boolean("tiling-mode-enabled", false);
    const reloadSpy = vi.spyOn(wm(), "reloadTree");
    const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm()._onSettingsChanged("tiling-mode-enabled");

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledWith("tiling-mode-enabled");
  });
});
