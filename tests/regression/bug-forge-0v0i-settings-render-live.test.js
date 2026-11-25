import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * Settings that the render reads but whose change did not cause one: the tiles
 * kept the old margins, split border, tab bar and lone-window maximize until an
 * unrelated event rendered.
 */
describe("a setting the render reads re-renders when it changes", () => {
  let ctx;
  let renderTree;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    renderTree = vi.spyOn(ctx.windowManager, "renderTree").mockImplementation(() => {});
  });

  afterEach(() => ctx.cleanup());

  it.each([
    "window-margin-top",
    "window-margin-bottom",
    "window-margin-left",
    "window-margin-right",
  ])("%s lays the tiles out again", (key) => {
    ctx.windowManager._onSettingsChanged(key);
    expect(renderTree).toHaveBeenCalledWith(key, true);
  });

  it.each(["split-border-toggle", "showtab-decoration-enabled", "window-maximize-on-single"])(
    "%s renders",
    (key) => {
      ctx.windowManager._onSettingsChanged(key);
      expect(renderTree).toHaveBeenCalledWith(key);
    }
  );
});
