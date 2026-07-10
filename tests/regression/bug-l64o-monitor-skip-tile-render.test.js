import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Bug forge-l64o: the settings "changed" switch had a case for workspace-skip-tile
 * (force re-render) but NONE for its sibling monitor-skip-tile, and a bare default
 * break. So editing "Non-tiling monitors" in prefs did nothing until an unrelated
 * render, while the adjacent "Non-tiling workspaces" field applied instantly —
 * making the setting look broken.
 *
 * Fix: add a monitor-skip-tile case beside workspace-skip-tile.
 */
describe("Bug forge-l64o: monitor-skip-tile forces a re-render", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("re-renders (forced) on monitor-skip-tile, matching workspace-skip-tile", () => {
    const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

    wm()._onSettingsChanged("monitor-skip-tile");
    expect(renderSpy).toHaveBeenCalledWith("monitor-skip-tile", true);

    // Sibling control: workspace-skip-tile already behaved this way.
    wm()._onSettingsChanged("workspace-skip-tile");
    expect(renderSpy).toHaveBeenCalledWith("workspace-skip-tile", true);

    // Routing control: an unhandled key hits the default break and does not render.
    renderSpy.mockClear();
    wm()._onSettingsChanged("resize-amount");
    expect(renderSpy).not.toHaveBeenCalled();
  });
});
