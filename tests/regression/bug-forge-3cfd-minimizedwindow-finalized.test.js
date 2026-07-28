import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createTiledWindow,
  finalizeWindow,
} from "../mocks/helpers/index.js";
import { MotionDirection } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-3cfd (audit-rc-2026-07 / F7): the _handleResizing pair-walk reads
 * `.minimized` on a finalized wrapper synchronously pre-prune. Two sites on that
 * path lacked an aliveness probe:
 *   - minimizedWindow() (window.js:2655): `node._data && node._data.minimized`
 *   - nextVisible() (tree.js:1680): `next.nodeValue && next.nodeValue.minimized`,
 *     the sole feeder of the pair-walk (window.js:3409/3438) — it throws FIRST,
 *     before minimizedWindow() is ever reached, so guarding minimizedWindow alone
 *     does not close the cited crash (peer-review finding).
 *
 * Fix: add Utils.isWindowAlive to both; a dead wrapper is walked past like a
 * minimized one.
 */
describe("Bug forge-3cfd: resize pair-walk tolerates a finalized wrapper", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("minimizedWindow returns false (not a throw) for a finalized window node", () => {
    const { nodeWindow, metaWindow } = createTiledWindow(ctx, { id: 3701 });
    finalizeWindow(metaWindow);

    let result;
    expect(() => {
      result = ctx.windowManager.minimizedWindow(nodeWindow);
    }).not.toThrow();
    expect(result).toBeFalsy();
  });

  it("nextVisible walks past a finalized sibling instead of throwing", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    const left = ctx.tree.createNode(
      monitor.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ id: 3702, workspace: ctx.workspaces[0] })
    );
    left.mode = WINDOW_MODES.TILE;

    const dead = createMockWindow({ id: 3703, workspace: ctx.workspaces[0] });
    const deadNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dead);
    deadNode.mode = WINDOW_MODES.TILE;
    finalizeWindow(dead);

    // Walking right from `left` reaches the finalized node, then the monitor
    // boundary; the dead wrapper must be skipped, not dereferenced.
    let beyond;
    expect(() => {
      beyond = ctx.tree.nextVisible(left, MotionDirection.RIGHT);
    }).not.toThrow();
    expect(beyond).not.toBe(deadNode);
    expect(beyond).toBeNull();
  });
});
