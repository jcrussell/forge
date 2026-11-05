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
 * forge-0zvq (gh-566): focusing a window inside a split that is a member of a
 * tabbed/stacked group raised only that window, so in TABBED[W1, HSPLIT[W2,
 * W3]] reaching W2 by keyboard, alt-tab or an app focus request left W3 under
 * W1 and W1 showed through. The group update keyed on the focused window's
 * immediate parent instead of the nearest tabbed/stacked ancestor.
 *
 * Fix: FocusManager.updateGroupFocus raises everything the outermost group's
 * member shows (Tree.shownWindows), the focused window last.
 */
describe("forge-0zvq: focusing a window in a split member raises the whole split", () => {
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

  for (const layout of [LAYOUT_TYPES.TABBED, LAYOUT_TYPES.STACKED]) {
    it(`${layout}[W1, HSPLIT[W2, W3]]: focusing W2 raises W3, then W2 on top`, () => {
      const W2 = win("W2");
      monitor.appendChild(con(layout, [win("W1"), con(LAYOUT_TYPES.HSPLIT, [W2, win("W3")])]));

      focusManager.updateGroupFocus(W2);

      expect(raised).toEqual(["W3", "W2"]);
    });
  }

  it("raises only the shown tab of a group nested in the member split", () => {
    // TABBED[W1, HSPLIT[TABBED[a, b], W3]] with b shown: focusing W3 raises b, not a.
    const b = win("b");
    const W3 = win("W3");
    const inner = con(LAYOUT_TYPES.TABBED, [win("a"), b]);
    inner.lastTabFocus = b.nodeValue;
    monitor.appendChild(
      con(LAYOUT_TYPES.TABBED, [win("W1"), con(LAYOUT_TYPES.HSPLIT, [inner, W3])])
    );

    focusManager.updateGroupFocus(W3);

    expect(raised).toEqual(["b", "W3"]);
  });
});
