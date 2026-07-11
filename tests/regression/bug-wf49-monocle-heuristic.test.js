import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-wf49: toggleWorkspaceMonocle heuristic misfired.
 *
 * (a) isMonocle only checked "one TABBED CON with >1 children", never that the
 *     CON held ALL tiled windows — so a loose tiled window beside a user-made
 *     tabbed group made the toggle take the EXIT branch and destructively flatten
 *     the group to a split.
 * (b) entering monocle collected only non-minimized leaves, so a nested CON
 *     holding a minimized window was never emptied/pruned — the monitor kept two
 *     CONs and the user could never exit monocle.
 */
describe("forge-wf49: workspace monocle heuristic", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
  });

  afterEach(() => ctx.cleanup());

  function tileWin(id, minimized = false) {
    const meta = createMockWindow({ id, workspace: ctx.workspaces[0], minimized });
    const node = new Node(NODE_TYPES.WINDOW, meta);
    node.settings = ctx.tree.settings;
    node.mode = WINDOW_MODES.TILE;
    node.rect = { x: 0, y: 0, width: 400, height: 600 };
    return node;
  }

  function con(layout) {
    const node = new Node(NODE_TYPES.CON, new Bin());
    node.settings = ctx.tree.settings;
    node.layout = layout;
    node.rect = { x: 0, y: 0, width: 600, height: 600 };
    return node;
  }

  it("(a) enters monocle instead of flattening a user tabbed group beside a loose window", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1200, height: 800 };

    // User-made TABBED group of two windows...
    const group = con(LAYOUT_TYPES.TABBED);
    monitor.appendChild(group);
    const w1 = tileWin(4001);
    const w2 = tileWin(4002);
    group.appendChild(w1);
    group.appendChild(w2);
    // ...beside a loose tiled window.
    const w3 = tileWin(4003);
    monitor.appendChild(w3);

    ctx.windowManager.toggleWorkspaceMonocle();

    // The user group must NOT be flattened. Instead the toggle enters monocle,
    // keeping the CON TABBED and absorbing the loose window.
    expect(group.layout).toBe(LAYOUT_TYPES.TABBED);
    expect(group.childNodes).toContain(w1);
    expect(group.childNodes).toContain(w2);
    expect(group.childNodes).toContain(w3);
  });

  it("(b) can exit monocle even when a nested CON held a minimized window", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1200, height: 800 };

    // Two side-by-side split containers; the second holds a minimized window.
    const conA = con(LAYOUT_TYPES.VSPLIT);
    const conB = con(LAYOUT_TYPES.VSPLIT);
    monitor.appendChild(conA);
    monitor.appendChild(conB);
    conA.appendChild(tileWin(5001));
    conA.appendChild(tileWin(5002));
    conB.appendChild(tileWin(5003));
    conB.appendChild(tileWin(5004, /* minimized */ true));

    // Enter monocle: all windows (incl. the minimized one) consolidate into one
    // CON, so the other CON empties and is pruned.
    ctx.windowManager.toggleWorkspaceMonocle();
    const consAfterEnter = monitor.getNodeByType(NODE_TYPES.CON);
    expect(consAfterEnter.length).toBe(1);
    expect(consAfterEnter[0].layout).toBe(LAYOUT_TYPES.TABBED);

    // Exit monocle: must return to a split layout, not stay stuck in TABBED.
    ctx.windowManager.toggleWorkspaceMonocle();
    const consAfterExit = monitor.getNodeByType(NODE_TYPES.CON);
    expect(consAfterExit.length).toBe(1);
    expect([LAYOUT_TYPES.HSPLIT, LAYOUT_TYPES.VSPLIT]).toContain(consAfterExit[0].layout);
  });
});
