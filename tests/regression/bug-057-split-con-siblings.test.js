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
 * Bug #57 (forge-37r): stack/tab windows with split-con siblings.
 *
 * Tree:  monitor -> parentCon [ W , nestedCon[ A , B ] ]
 *
 * When parentCon is toggled TABBED/STACKED, the nested split container must be
 * preserved as a single i3-style header item rather than flattened. Previously
 * only WINDOW nodes got a header tab (Node._createWindowTab early-returned for
 * non-windows) and processTabbed's gate (`child.isWindow()`) skipped CON children
 * — worse, naively relaxing that gate threw at `child.actor.border.get_theme_node()`
 * because CON actors have no border.
 *
 * The previous regression test here was vacuous: it built CON-only hand-rolled
 * trees, set `node.layout` directly, and only asserted child counts — never
 * exercising the command handlers, tab creation, or the renderer.
 */
describe("Bug #57: nested split-con siblings in tabbed/stacked containers", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "tiling-mode-enabled": true,
        "tabbed-tiling-mode-enabled": true,
        "stacked-tiling-mode-enabled": true,
        "showtab-decoration-enabled": true,
        "auto-exit-tabbed": false,
      },
    });
    ctx.display.sort_windows_by_stacking = vi.fn((w) => w);
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const wm = () => ctx.windowManager;

  // Build monitor -> parentCon [ W, nestedCon[ A, B ] ] and return the nodes.
  function buildNestedTree() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const tree = ctx.tree;

    const parentCon = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    parentCon.layout = LAYOUT_TYPES.HSPLIT;

    const wWin = createMockWindow({ id: "W", title: "Window W" });
    const nodeW = tree.createNode(parentCon.nodeValue, NODE_TYPES.WINDOW, wWin);
    nodeW.mode = WINDOW_MODES.TILE;

    const nestedCon = tree.createNode(parentCon.nodeValue, NODE_TYPES.CON, new Bin());
    nestedCon.layout = LAYOUT_TYPES.VSPLIT;

    const aWin = createMockWindow({ id: "A", title: "Window A" });
    const nodeA = tree.createNode(nestedCon.nodeValue, NODE_TYPES.WINDOW, aWin);
    nodeA.mode = WINDOW_MODES.TILE;
    const bWin = createMockWindow({ id: "B", title: "Window B" });
    const nodeB = tree.createNode(nestedCon.nodeValue, NODE_TYPES.WINDOW, bWin);
    nodeB.mode = WINDOW_MODES.TILE;

    return { monitor, parentCon, nodeW, nestedCon, nodeA, nodeB };
  }

  describe("structure preservation through the real command path", () => {
    it("keeps the nested container intact when toggling parent to TABBED", () => {
      const { parentCon, nodeW, nestedCon } = buildNestedTree();
      ctx.display.get_focus_window.mockReturnValue(nodeW.nodeValue);
      vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      wm().command({ name: "LayoutTabbedToggle" });

      expect(parentCon.layout).toBe(LAYOUT_TYPES.TABBED);
      // 2 direct children (W + nestedCon), NOT 3 flattened (W, A, B)
      expect(parentCon.childNodes.length).toBe(2);
      expect(nestedCon.nodeType).toBe(NODE_TYPES.CON);
      expect(nestedCon.layout).toBe(LAYOUT_TYPES.VSPLIT);
      expect(nestedCon.childNodes.length).toBe(2);
    });

    it("keeps the nested container intact when toggling parent to STACKED", () => {
      const { parentCon, nodeW, nestedCon } = buildNestedTree();
      ctx.display.get_focus_window.mockReturnValue(nodeW.nodeValue);
      vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      wm().command({ name: "LayoutStackedToggle" });

      expect(parentCon.layout).toBe(LAYOUT_TYPES.STACKED);
      expect(parentCon.childNodes.length).toBe(2);
      expect(nestedCon.childNodes.length).toBe(2);
    });
  });

  describe("CON header tab", () => {
    it("_getTitle() borrows the representative window's title for a CON", () => {
      const { nestedCon } = buildNestedTree();
      expect(nestedCon._getTitle()).toBe("Window A");
    });

    it("_ensureConTab() builds a header tab for a CON with windows", () => {
      const { nestedCon } = buildNestedTree();
      expect(nestedCon.tab).toBeNull();

      nestedCon._ensureConTab();

      expect(nestedCon.tab).not.toBeNull();
      // index 1 is the title button (matches the window-tab layout for Node.render())
      expect(nestedCon.tab.get_child_at_index(1).label).toBe("Window A");
    });

    it("_ensureConTab() rebuilds when the representative window changes", () => {
      const { nestedCon, nodeA } = buildNestedTree();
      nestedCon._ensureConTab();
      const firstTab = nestedCon.tab;

      // Remove A so B becomes the representative window
      ctx.tree.removeNode(nodeA);
      nestedCon._ensureConTab();

      expect(nestedCon.tab).not.toBe(firstTab);
      expect(nestedCon.tab.get_child_at_index(1).label).toBe("Window B");
    });
  });

  describe("renderer does not throw and attaches the CON tab (was the crash)", () => {
    it("renders a TABBED parent containing a nested split CON", () => {
      const { parentCon, nestedCon } = buildNestedTree();
      parentCon.layout = LAYOUT_TYPES.TABBED;
      parentCon.rect = { x: 0, y: 0, width: 1920, height: 1080 };

      // Naive gate relaxation would throw here on the CON's missing actor.border.
      expect(() => ctx.tree.processNode(parentCon)).not.toThrow();

      // The nested CON now has a header tab attached to the parent's decoration.
      expect(nestedCon.tab).not.toBeNull();
      expect(parentCon.decoration.contains(nestedCon.tab)).toBe(true);
    });
  });
});
