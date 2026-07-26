import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * Bug forge-jdbe: removeNode's auto-exit-tabbed block tested `parentNode` (the
 * closing node's direct parent) rather than `closedContainer` (the container that
 * actually lost a child). In the single-child-collapse branch parentNode is the
 * now-DETACHED sub-CON, so a nested split under a tabbed container never un-tabbed
 * on close — the tabbed parent kept a lone tab and swallowed the next new window.
 *
 * Fix: test closedContainer, mirroring the forge-vw0l reorient fix.
 */
describe("Bug forge-jdbe: auto-exit-tabbed fires on nested-split collapse", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "auto-exit-tabbed": true } });
    vi.spyOn(ctx.windowManager, "renderTree").mockImplementation(() => {});
  });

  afterEach(() => ctx.cleanup());

  it("exits TABBED when a single-window sub-CON collapses out of a tabbed parent", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    // TABBED T holding [ splitCON[winC], winB ] — the Bug #57 nested-split-in-tabbed
    // shape (cleanTree does not flatten a single-WINDOW sub-CON).
    const tabbed = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    tabbed.layout = LAYOUT_TYPES.TABBED;
    tabbed.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    const subCon = ctx.tree.createNode(tabbed.nodeValue, NODE_TYPES.CON, new Bin());
    subCon.layout = LAYOUT_TYPES.VSPLIT;
    const winC = ctx.tree.createNode(
      subCon.nodeValue,
      NODE_TYPES.WINDOW,
      createMockWindow({ id: 1 })
    );
    winC.mode = WINDOW_MODES.TILE;
    ctx.tree.createNode(tabbed.nodeValue, NODE_TYPES.WINDOW, createMockWindow({ id: 2 })).mode =
      WINDOW_MODES.TILE;

    ctx.tree.removeNode(winC);

    // subCon collapsed; T lost a child and now holds only winB, so it must exit
    // TABBED. Pre-fix the guard checked the detached subCon (a split, not TABBED)
    // and T stayed TABBED with a lone tab.
    expect(tabbed.layout).not.toBe(LAYOUT_TYPES.TABBED);
  });
});
