import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { FocusManager } from "../../lib/extension/focus.js";
import * as Utils from "../../lib/extension/utils.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-8bpp: updateGroupFocus raised every window the outermost group's member
 * shows on every focus, so in TABBED[W1, HSPLIT[W2, W3]] with a float covering
 * W3, focusing W2 again put W3 over the float.
 *
 * Fix: when Mutter already stacks the member's shown windows above the rest of
 * the group, updateGroupFocus raises only the focused window.
 */
describe("forge-8bpp: refocusing a window in a shown split member raises only it", () => {
  let ctx;
  let monitor;
  let focusManager;
  let raised;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    focusManager = new FocusManager(ctx.tree, ctx.extWm);
    raised = [];
    vi.spyOn(Utils, "safeRaise").mockImplementation((w) => raised.push(w.get_wm_class()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  function win(id) {
    const node = new Node(NODE_TYPES.WINDOW, createMockWindow({ id, wm_class: id }));
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  function con(layout, children) {
    const node = new Node(NODE_TYPES.CON, new Bin());
    node.layout = layout;
    children.forEach((child) => node.appendChild(child));
    return node;
  }

  /** Mutter's stacking, bottom to top. */
  function stacking(...nodes) {
    const order = nodes.map((n) => n.nodeValue);
    ctx.display.sort_windows_by_stacking.mockImplementation((wins) =>
      [...wins].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    );
  }

  for (const layout of [LAYOUT_TYPES.TABBED, LAYOUT_TYPES.STACKED]) {
    describe(`${layout}[W1, HSPLIT[W2, W3]]`, () => {
      let W1, W2, W3, group;

      beforeEach(() => {
        W1 = win("W1");
        W2 = win("W2");
        W3 = win("W3");
        group = con(layout, [W1, con(LAYOUT_TYPES.HSPLIT, [W2, W3])]);
        monitor.appendChild(group);
      });

      it("focusing W2 while the split already shows raises only W2", () => {
        group.lastTabFocus = W2.nodeValue;
        stacking(W1, W3, W2);

        focusManager.updateGroupFocus(W2);

        expect(raised).toEqual(["W2"]);
      });

      it("focusing W2 while W1 is still stacked over W3 raises W3, then W2", () => {
        // processFloats has already recorded W2 as shown (alt-tab, forge-0zvq).
        group.lastTabFocus = W2.nodeValue;
        stacking(W3, W1, W2);

        focusManager.updateGroupFocus(W2);

        expect(raised).toEqual(["W3", "W2"]);
      });
    });
  }
});
