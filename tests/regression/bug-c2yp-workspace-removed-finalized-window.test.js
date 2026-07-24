import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  finalizeWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-c2yp: the 'workspace-removed' handler calls
 * _rehomeWorkspaceWindowsBeforeRemoval FIRST, with no try/catch. That walks the
 * doomed workspace's WINDOW nodes and calls _rehomeWindowToLiveLocation ->
 * _validWindow -> metaWindow.get_wm_class(). On a finalized GJS wrapper (the
 * missed-actor-destroy race) get_wm_class() THROWS, aborting the handler before
 * tree.removeWorkspace / renumberWorkspacesAfterRemoval ever run — leaving the
 * ws-index scaffold permanently desynced (+ signal/St.Bin leaks).
 *
 * Secondary site: _containerFullyMigrates' .every() called get_workspace() on
 * each sibling behind only a truthiness guard — a dead sibling throws identically.
 *
 * Fix: probe Utils.isWindowAlive before touching a possibly-finalized wrapper in
 * _rehomeWindowToLiveLocation and in the .every() sibling probe; guard the rehome
 * loop so one dead node can't abort the whole removal.
 */
describe("Bug forge-c2yp: workspace-removed survives a finalized window wrapper", () => {
  let ctx, tree, wm;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 0 } },
    });
    tree = ctx.tree;
    wm = ctx.windowManager;
    vi.spyOn(wm, "renderTree").mockImplementation(() => {});
    vi.spyOn(wm, "trackCurrentMonWs").mockImplementation(() => {});
    for (let i = 0; i < 2; i++) {
      const { monitor } = getWorkspaceAndMonitor(ctx, i, 0);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    }
  });

  afterEach(() => ctx.cleanup());

  it("does not abort removal when a doomed-workspace window is finalized", () => {
    const { monitor: mo0ws1 } = getWorkspaceAndMonitor(ctx, 1, 0);

    // A live window that Mutter has already moved to the surviving ws0...
    const live = createMockWindow({ id: "live" });
    live._workspace = ctx.workspaces[0];
    live._monitor = 0;
    const liveNode = tree.createNode(mo0ws1.nodeValue, NODE_TYPES.WINDOW, live);
    liveNode.mode = WINDOW_MODES.TILE;

    // ...and a finalized wrapper that throws on ANY property read.
    const dead = createMockWindow({ id: "dead" });
    const deadNode = tree.createNode(mo0ws1.nodeValue, NODE_TYPES.WINDOW, dead);
    deadNode.mode = WINDOW_MODES.TILE;
    finalizeWindow(dead);

    // The rehome preamble must not throw despite the dead node...
    expect(() => wm._rehomeWorkspaceWindowsBeforeRemoval(1)).not.toThrow();
    // ...and the rest of the handler must still run to completion.
    tree.removeWorkspace(1);
    tree.workspaceManager.renumberWorkspacesAfterRemoval(1);

    // Scaffold is gone: ws1 removed, and the live window rehomed to ws0 (not stranded).
    expect(tree.findNode("ws1")).toBeNull();
    const mo0ws0 = tree.findNode("mo0ws0");
    expect(liveNode.parentNode).toBe(mo0ws0);
  });

  it("_containerFullyMigrates tolerates a finalized sibling", () => {
    const { monitor: mon } = getWorkspaceAndMonitor(ctx, 0, 0);
    const mover = createMockWindow({ id: "mover" });
    mover._workspace = ctx.workspaces[0];
    mover._monitor = 0;
    tree.createNode(mon.nodeValue, NODE_TYPES.WINDOW, mover);

    const deadSibling = createMockWindow({ id: "deadSibling" });
    tree.createNode(mon.nodeValue, NODE_TYPES.WINDOW, deadSibling);
    finalizeWindow(deadSibling);

    expect(() => wm._containerFullyMigrates(mon, mover)).not.toThrow();
  });
});
