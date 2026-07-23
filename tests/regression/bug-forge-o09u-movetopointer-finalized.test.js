import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-o09u (audit-2026-07 / C7): moveWindowToPointer (from _handleGrabOpEnd)
 * dereferences the cached this.nodeWinAtPointer.nodeValue.get_frame_rect() guarded
 * only by nodeValue/parentNode truthiness — no Utils.isWindowAlive (the preview
 * path forge-xom3 has it). A fast Wayland close finalizes the wrapper while the
 * node is still attached, so the drop throws out of _handleGrabOpEnd and the grab
 * is never cleaned up (window stranded in GRAB_TILE, preview stays visible).
 *
 * Fix: probe liveness before get_frame_rect().
 */
describe("Bug forge-o09u: grab-end drop probes the cached node's liveness", () => {
  let ctx;
  const boom = () => {
    throw new Error("Object .Meta.Window has been already deallocated");
  };

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("does not throw when the cached nodeWinAtPointer wrapper is finalized", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    const draggedWin = createMockWindow({ id: 9301, workspace: ctx.workspaces[0] });
    const draggedNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, draggedWin);
    draggedNode.mode = WINDOW_MODES.GRAB_TILE;

    const dead = createMockWindow({ id: 9302, workspace: ctx.workspaces[0] });
    dead.get_id = boom;
    dead.get_frame_rect = boom;
    const deadNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dead);
    deadNode.mode = WINDOW_MODES.TILE;

    // What the last pointer motion cached — now finalized at drop time.
    ctx.windowManager.nodeWinAtPointer = deadNode;

    expect(() => ctx.windowManager.moveWindowToPointer(draggedNode)).not.toThrow();
  });
});
