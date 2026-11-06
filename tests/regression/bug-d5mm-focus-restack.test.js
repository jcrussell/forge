import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-d5mm: the metaWindow "focus" handler queued a "focus-update" callback
 * that called this.updateStackedFocus() and this.updateTabbedFocus() with NO
 * argument. Both early-return on a falsy node, so they were permanent no-ops on
 * the pointer/alt-tab/hover focus path — a STACKED container was never re-stacked
 * and a TABBED window never raised on plain focus (only Super+hjkl, which passes
 * the node, worked). Fix: resolve and pass the focused node. Since forge-0ym6 the
 * focused stack member is raised and remembered, not moved to the stack's end.
 */
describe("forge-d5mm: focus handler re-stacks the focused window", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  // Capture the queued "focus-update" callback fired by the metaWindow "focus"
  // signal (GLib timeouts don't run in tests, so we invoke it directly).
  function fireFocusAndGetUpdate(metaWindow) {
    const captured = [];
    vi.spyOn(wm(), "queueEvent").mockImplementation((eventObj) => captured.push(eventObj));
    ctx.display.get_focus_window.mockReturnValue(metaWindow);
    metaWindow.emit("focus", metaWindow);
    const update = captured.find((e) => e.name === "focus-update");
    expect(update).toBeDefined();
    return update.callback;
  }

  it("passes the focused node to updateGroupFocus (not undefined)", () => {
    const metaWindow = createMockWindow({ wm_class: "App", workspace: ctx.workspaces[0] });
    wm().trackWindow(null, metaWindow);
    const node = wm().tree.findNode(metaWindow);
    expect(node).toBeTruthy();

    const groupSpy = vi.spyOn(wm(), "updateGroupFocus");

    fireFocusAndGetUpdate(metaWindow)();

    expect(groupSpy).toHaveBeenCalledWith(node);
  });

  it("raises and records the focused window of its STACKED container, keeping the order", () => {
    const winA = createMockWindow({ wm_class: "A", workspace: ctx.workspaces[0] });
    const winB = createMockWindow({ wm_class: "B", workspace: ctx.workspaces[0] });
    const winC = createMockWindow({ wm_class: "C", workspace: ctx.workspaces[0] });
    wm().trackWindow(null, winA);
    wm().trackWindow(null, winB);
    wm().trackWindow(null, winC);

    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    monitor.layout = LAYOUT_TYPES.STACKED;
    const nodeA = wm().tree.findNode(winA);
    expect(nodeA.parentNode).toBe(monitor);
    const order = [...monitor.childNodes];
    const raiseSpy = vi.spyOn(winA, "raise");

    // Focus A (index 0): it is shown on top, but the stack order (the order
    // Super+J/K walks, forge-0ym6) stays as it was.
    fireFocusAndGetUpdate(winA)();

    expect(raiseSpy).toHaveBeenCalled();
    expect(monitor.lastTabFocus).toBe(winA);
    expect(monitor.childNodes).toEqual(order);
  });
});
