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
 * Bug forge-ib39 (from lint rule local/no-unguarded-window-deref, fhen.6):
 * sameParentMonitor() dereferenced firstNode.nodeValue.get_workspace().index()
 * after only a get_workspace() truthiness guard. But get_workspace() *throws*
 * on a finalized GJS wrapper (not returns null), so the guard call itself threw
 * "already deallocated". Its sole caller (tree.js move-swap) runs it right before
 * swapPairs, which already probes Utils.isWindowAlive — a finalized wrapper is
 * reachable here first.
 *
 * Fix: probe Utils.isWindowAlive before dereferencing; return false (no swap)
 * instead of throwing.
 */
describe("Bug forge-ib39: sameParentMonitor skips finalized windows", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("returns false instead of throwing when a node's window is finalized", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    const live = createMockWindow({ id: 8801, workspace: ctx.workspaces[0] });
    const liveNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, live);
    liveNode.mode = WINDOW_MODES.TILE;

    const dead = createMockWindow({ id: 8802, workspace: ctx.workspaces[0] });
    const deadNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dead);
    deadNode.mode = WINDOW_MODES.TILE;
    finalizeWindow(dead);

    let result;
    expect(() => {
      result = ctx.windowManager.sameParentMonitor(liveNode, deadNode);
    }).not.toThrow();
    expect(result).toBe(false);

    // Order-independent: a finalized first node bails before touching the second.
    expect(() => ctx.windowManager.sameParentMonitor(deadNode, liveNode)).not.toThrow();
    expect(ctx.windowManager.sameParentMonitor(deadNode, liveNode)).toBe(false);
  });

  it("still reports true for two live windows sharing a monitor+workspace", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    const a = createMockWindow({ id: 8803, workspace: ctx.workspaces[0] });
    const aNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, a);
    aNode.mode = WINDOW_MODES.TILE;

    const b = createMockWindow({ id: 8804, workspace: ctx.workspaces[0] });
    const bNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, b);
    bNode.mode = WINDOW_MODES.TILE;

    expect(ctx.windowManager.sameParentMonitor(aNode, bNode)).toBe(true);
  });
});
