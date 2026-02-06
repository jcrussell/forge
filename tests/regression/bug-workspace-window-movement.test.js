import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Tree, Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
  createHorizontalLayout,
} from "../mocks/helpers/index.js";
import * as Utils from "../../lib/extension/utils.js";

/**
 * Bug: Workspace Window Movement - Remaining windows don't expand / preserve proportions
 *
 * Problem: When moving a window between workspaces (via Shift-Super-PageUp/Down
 * or drag-and-drop), while staying on the source workspace, the remaining
 * windows on the source workspace should:
 * 1. Expand to fill the gap left by the moved window
 * 2. Preserve their relative proportions (not reset to equal sizes)
 *
 * Solution: redistributeSiblingPercent() scales remaining children proportionally
 * instead of resetting to 0.0 (equal distribution).
 *
 * Example:
 * - Initial: A=25%, B=50%, C=25%
 * - Move A to another workspace
 * - Desired: B=66.7%, C=33.3% (proportionally scaled)
 */
describe("Bug: Workspace window movement - remaining windows should expand", () => {
  let ctx;
  let tree;
  let monitor0Ws0; // Monitor 0 on workspace 0
  let monitor0Ws1; // Monitor 0 on workspace 1

  beforeEach(() => {
    // Create fixture with 2 workspaces
    ctx = createTreeFixture({
      globals: {
        workspaceManager: { workspaceCount: 2, activeWorkspaceIndex: 0 },
      },
      fullExtWm: true,
    });
    tree = ctx.tree;

    // Get monitor nodes for both workspaces
    const { monitor: mon0Ws0 } = getWorkspaceAndMonitor(ctx, 0, 0);
    monitor0Ws0 = mon0Ws0;
    monitor0Ws0.layout = LAYOUT_TYPES.HSPLIT;
    monitor0Ws0.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    const { monitor: mon0Ws1 } = getWorkspaceAndMonitor(ctx, 1, 0);
    monitor0Ws1 = mon0Ws1;
    monitor0Ws1.layout = LAYOUT_TYPES.HSPLIT;
    monitor0Ws1.rect = { x: 0, y: 0, width: 1920, height: 1080 };

    ctx.extWm.currentMonWsNode = monitor0Ws0;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("Window movement between workspaces", () => {
    it("should preserve proportions when one window is moved to another workspace", () => {
      // Setup: Create 3 windows on workspace 0 in HSPLIT layout with custom proportions
      // [  A  ] [      B      ] [  C  ]
      // A=25%, B=50%, C=25% -> A=480px, B=960px, C=480px
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      // Set workspace for all windows to workspace 0
      windowA._workspace = ctx.workspaces[0];
      windowA._monitor = 0;
      windowB._workspace = ctx.workspaces[0];
      windowB._monitor = 0;
      windowC._workspace = ctx.workspaces[0];
      windowC._monitor = 0;

      const nodeA = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Set explicit percentages: A=25%, B=50%, C=25%
      nodeA.percent = 0.25;
      nodeB.percent = 0.5;
      nodeC.percent = 0.25;

      // Verify initial state: 3 children on workspace 0's monitor
      expect(monitor0Ws0.childNodes.length).toBe(3);
      expect(monitor0Ws0.childNodes).toContain(nodeA);
      expect(monitor0Ws0.childNodes).toContain(nodeB);
      expect(monitor0Ws0.childNodes).toContain(nodeC);

      // Process tree to calculate initial sizes
      tree.processNode(tree);

      // Verify initial sizes based on percentages
      const initialTiledChildren = tree.getTiledChildren(monitor0Ws0.childNodes);
      expect(initialTiledChildren.length).toBe(3);
      const initialSizes = tree.computeSizes(monitor0Ws0, initialTiledChildren);
      expect(initialSizes.length).toBe(3);
      // A=480px (25%), B=960px (50%), C=480px (25%)
      expect(initialSizes[0]).toBe(480); // A
      expect(initialSizes[1]).toBe(960); // B
      expect(initialSizes[2]).toBe(480); // C

      // Simulate moving window A to workspace 1:
      // 1. Change window's workspace
      windowA._workspace = ctx.workspaces[1];

      // 2. Store parent reference, move node, then redistribute (this is what updateMetaWorkspaceMonitor does)
      const existParent = nodeA.parentNode;
      monitor0Ws1.appendChild(nodeA);
      tree.redistributeSiblingPercent(existParent);

      // Verify window was moved
      expect(monitor0Ws0.childNodes.length).toBe(2);
      expect(monitor0Ws0.childNodes).not.toContain(nodeA);
      expect(monitor0Ws0.childNodes).toContain(nodeB);
      expect(monitor0Ws0.childNodes).toContain(nodeC);
      expect(monitor0Ws1.childNodes).toContain(nodeA);

      // KEY ASSERTION: Percentages should be scaled proportionally
      // Before: B=50%, C=25% (total=75%)
      // After scaling: B=50%/75%=66.7%, C=25%/75%=33.3%
      expect(nodeB.percent).toBeCloseTo(0.6667, 3);
      expect(nodeC.percent).toBeCloseTo(0.3333, 3);

      // Process tree again (simulating renderTree)
      tree.processNode(tree);

      // Verify computed sizes reflect proportional distribution
      const afterTiledChildren = tree.getTiledChildren(monitor0Ws0.childNodes);
      expect(afterTiledChildren.length).toBe(2);
      const afterSizes = tree.computeSizes(monitor0Ws0, afterTiledChildren);
      expect(afterSizes.length).toBe(2);

      // B should get ~66.7% of 1920 = 1280px, C should get ~33.3% = 640px
      expect(afterSizes[0]).toBeCloseTo(1280, -1); // B (allow 10px tolerance)
      expect(afterSizes[1]).toBeCloseTo(640, -1); // C (allow 10px tolerance)
    });

    it("should expand remaining windows when moving from 3 to 1 window", () => {
      // Setup: Create 3 windows on workspace 0 with explicit percentages
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowA._workspace = ctx.workspaces[0];
      windowA._monitor = 0;
      windowB._workspace = ctx.workspaces[0];
      windowB._monitor = 0;
      windowC._workspace = ctx.workspaces[0];
      windowC._monitor = 0;

      const nodeA = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Set explicit percentages
      nodeA.percent = 0.25;
      nodeB.percent = 0.5;
      nodeC.percent = 0.25;

      // Move windows A and B to workspace 1
      // Move A first
      windowA._workspace = ctx.workspaces[1];
      const existParentA = nodeA.parentNode;
      monitor0Ws1.appendChild(nodeA);
      tree.redistributeSiblingPercent(existParentA);

      // After moving A: B=50%/75%=66.7%, C=25%/75%=33.3%
      expect(nodeB.percent).toBeCloseTo(0.6667, 3);
      expect(nodeC.percent).toBeCloseTo(0.3333, 3);

      // Move B second
      windowB._workspace = ctx.workspaces[1];
      const existParentB = nodeB.parentNode;
      monitor0Ws1.appendChild(nodeB);
      tree.redistributeSiblingPercent(existParentB);

      // After moving B: C becomes 100% (only child, scaled from 33.3%/33.3%)
      expect(nodeC.percent).toBeCloseTo(1.0, 3);

      // Verify only C remains on workspace 0
      expect(monitor0Ws0.childNodes.length).toBe(1);
      expect(monitor0Ws0.childNodes).toContain(nodeC);

      // Process tree
      tree.processNode(tree);

      // C should get 100% of width (1920px)
      const tiledChildren = tree.getTiledChildren(monitor0Ws0.childNodes);
      expect(tiledChildren.length).toBe(1);
      const sizes = tree.computeSizes(monitor0Ws0, tiledChildren);
      expect(sizes.length).toBe(1);
      expect(sizes[0]).toBe(1920);
    });

    it("should preserve proportions in VSPLIT layout", () => {
      // Setup: Change to VSPLIT layout
      monitor0Ws0.layout = LAYOUT_TYPES.VSPLIT;

      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowA._workspace = ctx.workspaces[0];
      windowA._monitor = 0;
      windowB._workspace = ctx.workspaces[0];
      windowB._monitor = 0;
      windowC._workspace = ctx.workspaces[0];
      windowC._monitor = 0;

      const nodeA = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Set explicit percentages: A=20%, B=60%, C=20% (height-based)
      nodeA.percent = 0.2;
      nodeB.percent = 0.6;
      nodeC.percent = 0.2;

      // Process to get initial sizes (based on height: 1080)
      tree.processNode(tree);
      const initialSizes = tree.computeSizes(
        monitor0Ws0,
        tree.getTiledChildren(monitor0Ws0.childNodes)
      );
      // A=216px (20%), B=648px (60%), C=216px (20%)
      expect(initialSizes[0]).toBe(216); // A
      expect(initialSizes[1]).toBe(648); // B
      expect(initialSizes[2]).toBe(216); // C

      // Move window A to workspace 1
      windowA._workspace = ctx.workspaces[1];
      const existParent = nodeA.parentNode;
      monitor0Ws1.appendChild(nodeA);
      tree.redistributeSiblingPercent(existParent);

      // After moving A: B=60%/80%=75%, C=20%/80%=25%
      expect(nodeB.percent).toBeCloseTo(0.75, 3);
      expect(nodeC.percent).toBeCloseTo(0.25, 3);

      // Process tree
      tree.processNode(tree);

      // Remaining windows should preserve their relative proportions
      // B=75% of 1080=810px, C=25% of 1080=270px
      const afterSizes = tree.computeSizes(
        monitor0Ws0,
        tree.getTiledChildren(monitor0Ws0.childNodes)
      );
      expect(afterSizes.length).toBe(2);
      expect(afterSizes[0]).toBe(810); // B
      expect(afterSizes[1]).toBe(270); // C
    });

    it("should fallback to equal distribution when no percentages are set", () => {
      // Setup: Create 3 windows with no explicit percentages (percent = 0)
      const windowA = createMockWindow({ id: "A" });
      const windowB = createMockWindow({ id: "B" });
      const windowC = createMockWindow({ id: "C" });

      windowA._workspace = ctx.workspaces[0];
      windowA._monitor = 0;
      windowB._workspace = ctx.workspaces[0];
      windowB._monitor = 0;
      windowC._workspace = ctx.workspaces[0];
      windowC._monitor = 0;

      const nodeA = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowA);
      const nodeB = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowB);
      const nodeC = tree.createNode(monitor0Ws0.nodeValue, NODE_TYPES.WINDOW, windowC);
      nodeA.mode = WINDOW_MODES.TILE;
      nodeB.mode = WINDOW_MODES.TILE;
      nodeC.mode = WINDOW_MODES.TILE;

      // Leave percentages at default (0.0 or undefined)
      // This simulates windows that have never been manually resized

      // Move window A to workspace 1
      windowA._workspace = ctx.workspaces[1];
      const existParent = nodeA.parentNode;
      monitor0Ws1.appendChild(nodeA);
      tree.redistributeSiblingPercent(existParent);

      // With no percentages set, should fallback to equal distribution
      expect(nodeB.percent).toBeCloseTo(0.5, 3);
      expect(nodeC.percent).toBeCloseTo(0.5, 3);

      // Process tree
      tree.processNode(tree);

      // Each window should get 50% of width (960px)
      const afterSizes = tree.computeSizes(
        monitor0Ws0,
        tree.getTiledChildren(monitor0Ws0.childNodes)
      );
      expect(afterSizes.length).toBe(2);
      expect(afterSizes[0]).toBe(960);
      expect(afterSizes[1]).toBe(960);
    });
  });

  describe("workspaceIndex utility", () => {
    it("should extract workspace index from nodeValue", () => {
      // nodeValue format is "mo{monitorIndex}ws{workspaceIndex}"
      expect(Utils.workspaceIndex("mo0ws0")).toBe(0);
      expect(Utils.workspaceIndex("mo0ws1")).toBe(1);
      expect(Utils.workspaceIndex("mo1ws0")).toBe(0);
      expect(Utils.workspaceIndex("mo1ws5")).toBe(5);
      expect(Utils.workspaceIndex("mo2ws10")).toBe(10);
    });

    it("should return -1 for invalid input", () => {
      expect(Utils.workspaceIndex(null)).toBe(-1);
      expect(Utils.workspaceIndex(undefined)).toBe(-1);
      expect(Utils.workspaceIndex("")).toBe(-1);
      expect(Utils.workspaceIndex("invalid")).toBe(-1);
    });
  });
});
