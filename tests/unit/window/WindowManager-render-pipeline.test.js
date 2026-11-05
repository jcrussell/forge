import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../../mocks/helpers/testFixtures.js";

/**
 * renderTree's idle callback is the reconcile pipeline. Its step order is a
 * contract: processFloats re-pins always-on-top floats via `set float`, so the
 * fullscreen demotion (forge-zo4) must run after it to win; tree.render places
 * the tiles that handleMaximizeOnSingle then inspects; decorations and borders
 * follow the final geometry.
 */
describe("WindowManager.renderTree pipeline", () => {
  let ctx, wm, calls;

  const STEPS = [
    ["tree", "pruneDeadWindows"],
    ["wm", "processFloats"],
    ["wm", "_reconcileFullscreenFloatDemotion"],
    ["tree", "render"],
    ["wm", "handleMaximizeOnSingle"],
    ["wm", "updateDecorationLayout"],
    ["wm", "updateBorderLayout"],
  ];

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    wm = ctx.windowManager;
    calls = [];
    for (const [owner, name] of STEPS) {
      const target = owner === "tree" ? wm.tree : wm;
      vi.spyOn(target, name).mockImplementation(() => calls.push(name));
    }
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("runs every step once, in order", () => {
    wm.renderTree("test");

    expect(calls).toEqual(STEPS.map(([, name]) => name));
  });

  it("renders again on each later call once the previous idle has fired", () => {
    wm.renderTree("first");
    wm.renderTree("second");
    wm.renderTree("third");

    expect(calls.filter((name) => name === "render")).toHaveLength(3);
    expect(wm._renderTreeSrcId).toBe(0);
  });
});
