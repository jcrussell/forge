import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createTreeFixture,
  getWorkspaceAndMonitor,
  createHorizontalLayout,
  finalizeWindow,
} from "../../mocks/helpers/index.js";

/**
 * Dead-window pruning (forge-4b6)
 *
 * A missed actor-destroy leaves a WINDOW node whose Meta.Window wrapper is
 * finalized: in GJS ANY property access on it throws ("Object Meta.Window ...
 * has been already deallocated"). One such node used to kill every subsequent
 * render tree-wide (processFloats/apply walk all workspaces), which is how one
 * leaked node after the e2e fuzz session cascaded into 39 downstream test
 * failures. pruneDeadWindows() at render start is the self-heal.
 *
 * finalizeWindow() turns a live node's own Meta.Window into a faithful finalized
 * wrapper in place: every method (incl. isWindowAlive's get_id() probe) throws,
 * while identity compares (node.nodeValue === x) still work.
 */

describe("Tree - pruneDeadWindows", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("prunes the dead node and keeps live siblings", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const wins = createHorizontalLayout(ctx.tree, monitor, 3);
    finalizeWindow(wins[1].nodeWindow.nodeValue);

    ctx.tree.pruneDeadWindows();

    expect(monitor.childNodes).toHaveLength(2);
    expect(monitor.childNodes).not.toContain(wins[1].nodeWindow);
    expect(monitor.childNodes).toContain(wins[0].nodeWindow);
    expect(monitor.childNodes).toContain(wins[2].nodeWindow);
  });

  it("is a no-op when all windows are alive", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const wins = createHorizontalLayout(ctx.tree, monitor, 2);

    ctx.tree.pruneDeadWindows();

    expect(monitor.childNodes).toHaveLength(2);
    expect(monitor.childNodes).toContain(wins[0].nodeWindow);
    expect(monitor.childNodes).toContain(wins[1].nodeWindow);
  });

  it("does not throw with multiple dead siblings", () => {
    // Exercises the isWindowAlive guard in getTiledChildren: removing the
    // first dead node walks the remaining siblings via cleanUpParent, which
    // must not touch the second dead wrapper's properties.
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const wins = createHorizontalLayout(ctx.tree, monitor, 3);
    finalizeWindow(wins[0].nodeWindow.nodeValue);
    finalizeWindow(wins[2].nodeWindow.nodeValue);

    expect(() => ctx.tree.pruneDeadWindows()).not.toThrow();

    expect(monitor.childNodes).toHaveLength(1);
    expect(monitor.childNodes).toContain(wins[1].nodeWindow);
  });

  it("excludes dead windows from tiled children and split space", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const wins = createHorizontalLayout(ctx.tree, monitor, 3);
    monitor.rect = { x: 0, y: 0, width: 900, height: 500 };
    finalizeWindow(wins[2].nodeWindow.nodeValue);

    // Dead node is not a tiled child even before the prune runs.
    expect(ctx.tree.getTiledChildren(monitor.childNodes)).toHaveLength(2);

    ctx.tree.pruneDeadWindows();

    // Space divides among live windows only (removeNode re-equalizes percents).
    const tiled = ctx.tree.getTiledChildren(monitor.childNodes);
    const sizes = ctx.tree.computeSizes(monitor, tiled);
    expect(sizes).toEqual([450, 450]);
  });

  it("prunes dead nodes across all workspaces, not just the active one", () => {
    ctx.cleanup();
    ctx = createTreeFixture({
      fullExtWm: true,
      globals: { workspaceManager: { workspaceCount: 2 } },
    });
    const { monitor: monitorWs0 } = getWorkspaceAndMonitor(ctx, 0);
    const { monitor: monitorWs1 } = getWorkspaceAndMonitor(ctx, 1);
    const ws0Wins = createHorizontalLayout(ctx.tree, monitorWs0, 1);
    const ws1Wins = createHorizontalLayout(ctx.tree, monitorWs1, 2);
    finalizeWindow(ws1Wins[0].nodeWindow.nodeValue);

    ctx.tree.pruneDeadWindows();

    expect(monitorWs0.childNodes).toContain(ws0Wins[0].nodeWindow);
    expect(monitorWs1.childNodes).toHaveLength(1);
    expect(monitorWs1.childNodes).toContain(ws1Wins[1].nodeWindow);
    expect(ctx.tree.getNodeByType(NODE_TYPES.WINDOW)).toHaveLength(2);
  });
});
