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
 * Bug forge-43zk: the minimize/unminimize handlers discarded the signal's
 * WindowActor and resolved tree.findNode(this.focusMetaWindow) — the DISPLAY
 * focus, a live getter. When the (un)minimized window is not the focus (a dock/
 * taskbar minimizing a background window, app self-minimize, wmctrl), the reset
 * wiped the FOCUSED container's ratios while the container that actually changed
 * kept stale percents.
 *
 * Fix: pass the signal actor's meta_window into _onMinimizeChange and resolve the
 * node from it (falling back to focus when absent).
 */
describe("Bug forge-43zk: minimize resets the signal window's container", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    vi.spyOn(wm(), "_renderWithFreezeState").mockImplementation(() => {});
    vi.spyOn(wm(), "hideWindowBorders").mockImplementation(() => {});
  });

  afterEach(() => ctx.cleanup());

  function buildCon() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const con = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new Bin());
    con.layout = LAYOUT_TYPES.HSPLIT;
    const a = ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
    const b = ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, createMockWindow());
    a.mode = WINDOW_MODES.TILE;
    b.mode = WINDOW_MODES.TILE;
    return { con, a, b };
  }

  it("resets the minimized window's parent, not the focused container", () => {
    const conA = buildCon();
    const conB = buildCon();
    // Focus stays on conA; a background window in conB is minimized.
    global.display.get_focus_window.mockReturnValue(conA.a.nodeValue);
    conB.a.nodeValue.minimized = true;

    const resetSpy = vi.spyOn(ctx.tree, "resetSiblingPercent");

    wm()._onMinimizeChange("minimize", {
      hideBorders: true,
      resetGrandparentIfEmpty: true,
      metaWindow: conB.a.nodeValue,
    });

    expect(resetSpy).toHaveBeenCalledWith(conB.con);
    expect(resetSpy).not.toHaveBeenCalledWith(conA.con);
  });
});
