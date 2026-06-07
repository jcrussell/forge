import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-7m3: Adding a new window re-equalizes the existing windows' sizes
 * instead of preserving their custom-resized proportions.
 *
 * trackWindow used to zero EVERY tiled sibling's percent when a window was added,
 * so computeSizes fell back to equal distribution and any user resizing was lost
 * (reproduced in real GNOME: [1227,669] -> [629,629,630]). Tree.insertChildPercent
 * now gives the newcomer a fair share while scaling the existing siblings to keep
 * their relative proportions, and keeps the equal-split default when nothing was
 * ever resized.
 */
describe("Bug forge-7m3: adding a window preserves existing proportions", () => {
  let ctx, tree, monitor;

  beforeEach(() => {
    ctx = createTreeFixture({
      globals: { workspaceManager: { workspaceCount: 1, activeWorkspaceIndex: 0 } },
    });
    tree = ctx.tree;
    monitor = getWorkspaceAndMonitor(ctx, 0, 0).monitor;
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
  });

  afterEach(() => ctx.cleanup());

  function addWindow(id, percent) {
    const win = createMockWindow({ id });
    win._monitor = 0;
    const node = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    if (percent != null) node.percent = percent;
    return node;
  }

  it("scales resized siblings to make room for the newcomer, preserving their ratio", () => {
    const a = addWindow("A", 0.7);
    const b = addWindow("B", 0.3);

    // New window arrives (FLOAT in production; percent assignment is what matters).
    const c = addWindow("C", null);
    tree.insertChildPercent(monitor, c);

    // Newcomer gets an equal third; A and B keep their 0.7:0.3 ratio, all sum ~1.
    expect(c.percent).toBeCloseTo(1 / 3, 5);
    expect(a.percent + b.percent + c.percent).toBeCloseTo(1.0, 5);
    expect(a.percent / b.percent).toBeCloseTo(0.7 / 0.3, 5);
    // Spread is preserved (not collapsed to equal) — the real-shell symptom.
    expect(a.percent / b.percent).toBeGreaterThan(2.0);
  });

  it("keeps equal-split behavior when no window was ever resized", () => {
    const a = addWindow("A", 0.0);
    const b = addWindow("B", 0.0);
    const c = addWindow("C", null);

    tree.insertChildPercent(monitor, c);

    // All zero -> computeSizes equal fallback (unchanged default behavior).
    expect(a.percent).toBe(0.0);
    expect(b.percent).toBe(0.0);
    expect(c.percent).toBe(0.0);
  });
});
