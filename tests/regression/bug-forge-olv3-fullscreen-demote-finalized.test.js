import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  finalizeWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-olv3 (audit-2026-07 / C3): _reconcileFullscreenFloatDemotion loops all
 * window nodes calling is_fullscreen()/is_above() guarded only by truthiness (no
 * Utils.isWindowAlive, unlike _forEachFloatNode). windowDestroy calls it
 * synchronously right after removeNode — pre-prune — so a sibling's finalized
 * wrapper throws, aborting windowDestroy (focus never restored, stale float
 * override persists).
 *
 * Fix: guard both loops with Utils.isWindowAlive.
 */
describe("Bug forge-olv3: fullscreen-float demotion skips finalized windows", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "float-always-on-top-enabled": true },
    });
  });

  afterEach(() => ctx.cleanup());

  it("does not throw when a float wrapper is finalized", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    const live = createMockWindow({ id: 9201, workspace: ctx.workspaces[0] });
    const liveNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, live);
    liveNode.mode = WINDOW_MODES.FLOAT;

    const dead = createMockWindow({ id: 9202, workspace: ctx.workspaces[0] });
    const deadNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dead);
    deadNode.mode = WINDOW_MODES.FLOAT;
    finalizeWindow(dead);

    expect(() => ctx.windowManager._reconcileFullscreenFloatDemotion()).not.toThrow();
  });
});
