import { describe, it, expect, beforeEach } from "vitest";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { createTreeFixture, getWorkspaceAndMonitor } from "../mocks/helpers/index.js";
import { createMockWindow } from "../mocks/helpers/mockWindow.js";

/**
 * Bug: Missing break in tree._search() MODE case causes fallthrough to LAYOUT case
 *
 * Problem: In Tree._search(), the MODE case was missing a `break` statement,
 * causing it to fall through to the LAYOUT case. This meant that searching
 * by MODE would incorrectly also match nodes by LAYOUT if both conditions
 * happened to be satisfied.
 *
 * Root Cause: Missing `break` statement after MODE case in switch statement.
 *
 * File: lib/extension/tree.js, _search() method
 */
describe("Bug: _search() MODE case fallthrough to LAYOUT", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTreeFixture();
  });

  describe("_search by MODE", () => {
    it("should only match nodes by mode, not by layout", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create a window with TILE mode
      const mockWindow = createMockWindow({
        id: 1001,
        wm_class: "test-window",
        allows_resize: true,
      });

      const windowNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, mockWindow);
      windowNode.mode = WINDOW_MODES.TILE;

      // Set up monitor with HSPLIT layout (which has a string value)
      monitor.layout = LAYOUT_TYPES.HSPLIT;

      // Search by MODE for TILE windows
      const modeResults = ctx.tree._search(WINDOW_MODES.TILE, "MODE");

      // Should find the TILE mode window
      expect(modeResults).toContain(windowNode);

      // Search by MODE for a value that matches a layout type
      // Before the fix, searching for a MODE that happened to equal a LAYOUT
      // would incorrectly include nodes matching that LAYOUT
      const layoutValue = LAYOUT_TYPES.HSPLIT;

      // This should NOT find the monitor node (which has layout=HSPLIT but no mode=HSPLIT)
      const incorrectResults = ctx.tree._search(layoutValue, "MODE");

      // The monitor node should NOT be in results because we're searching by MODE,
      // not by LAYOUT
      expect(incorrectResults).not.toContain(monitor);
    });

    it("should not include nodes in MODE search that match by layout", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Set monitor layout to STACKED
      monitor.layout = LAYOUT_TYPES.STACKED;

      // Create windows with different modes
      const window1 = createMockWindow({ id: 1, wm_class: "test1", allows_resize: true });
      const window2 = createMockWindow({ id: 2, wm_class: "test2", allows_resize: true });

      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window2);

      node1.mode = WINDOW_MODES.TILE;
      node2.mode = WINDOW_MODES.FLOAT;

      // Search by MODE for FLOAT
      const floatResults = ctx.tree._search(WINDOW_MODES.FLOAT, "MODE");

      // Should only find node2 (FLOAT mode)
      expect(floatResults.length).toBe(1);
      expect(floatResults[0]).toBe(node2);

      // Should not include node1 (TILE mode)
      expect(floatResults).not.toContain(node1);
    });

    it("should search by LAYOUT independently from MODE", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Set monitor layout
      monitor.layout = LAYOUT_TYPES.VSPLIT;

      // Create a window
      const mockWindow = createMockWindow({ id: 1, wm_class: "test", allows_resize: true });
      const windowNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, mockWindow);
      windowNode.mode = WINDOW_MODES.TILE;

      // Search by LAYOUT for VSPLIT
      const layoutResults = ctx.tree._search(LAYOUT_TYPES.VSPLIT, "LAYOUT");

      // Should find the monitor (which has VSPLIT layout)
      expect(layoutResults).toContain(monitor);

      // Should NOT include the window (which has no layout property set to VSPLIT)
      expect(layoutResults).not.toContain(windowNode);
    });
  });

  describe("getNodeByMode", () => {
    it("should only return nodes matching the specified mode", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      // Create multiple windows with different modes
      const tileWindow = createMockWindow({ id: 1, wm_class: "tile", allows_resize: true });
      const floatWindow = createMockWindow({ id: 2, wm_class: "float", allows_resize: true });

      const tileNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, tileWindow);
      const floatNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, floatWindow);

      tileNode.mode = WINDOW_MODES.TILE;
      floatNode.mode = WINDOW_MODES.FLOAT;

      // Get nodes by TILE mode
      const tileNodes = ctx.tree.getNodeByMode(WINDOW_MODES.TILE);

      // Should include tile window
      expect(tileNodes).toContain(tileNode);

      // Should NOT include float window
      expect(tileNodes).not.toContain(floatNode);
    });
  });
});
