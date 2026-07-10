import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import * as Meta from "../mocks/gnome/Meta.js";

/**
 * Bug forge-mhje: trackWindow ran the auto-split preamble (which dispatches a
 * Split against the focused window) for EVERY window-created signal BEFORE the
 * _validWindow gate and the existNodeWindow dedupe. So a tooltip/menu/popup — or
 * a reload re-track of an already-tracked window — fired a spurious Split, wrapping
 * the focused window in a phantom single-child CON that never gets cleaned up.
 *
 * Fix: run the auto-split block only after _validWindow passes and only for a
 * genuinely new (untracked) window, before it is attached.
 */
describe("Bug forge-mhje: auto-split ignores invalid / already-tracked windows", () => {
  let ctx;
  const wm = () => ctx.windowManager;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "auto-split-enabled": true } });
    wm().renderTree = vi.fn();
    wm().queueEvent = vi.fn();
    wm().postProcessWindow = vi.fn();
  });

  afterEach(() => ctx.cleanup());

  it("does not Split when a POPUP_MENU is tracked", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const w0 = createMockWindow({ wm_class: "A", id: 1, allows_resize: true });
    const w1 = createMockWindow({ wm_class: "B", id: 2, allows_resize: true });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, w0).mode = WINDOW_MODES.TILE;
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, w1).mode = WINDOW_MODES.TILE;
    ctx.display.get_focus_window.mockReturnValue(w0);

    const commandSpy = vi.spyOn(wm(), "command");
    const popup = createMockWindow({
      wm_class: "Popup",
      id: 3,
      window_type: Meta.WindowType.POPUP_MENU,
    });

    wm().trackWindow(ctx.display, popup);

    expect(commandSpy).not.toHaveBeenCalledWith(expect.objectContaining({ name: "Split" }));
    // w0 stays directly under the monitor — no phantom wrapping CON.
    expect(ctx.tree.findNode(w0).parentNode).toBe(monitor);
  });

  it("does not Split when re-tracking an already-tracked window", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const w0 = createMockWindow({ wm_class: "A", id: 1, allows_resize: true });
    const w1 = createMockWindow({ wm_class: "B", id: 2, allows_resize: true });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, w0).mode = WINDOW_MODES.TILE;
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, w1).mode = WINDOW_MODES.TILE;
    ctx.display.get_focus_window.mockReturnValue(w0);

    const commandSpy = vi.spyOn(wm(), "command");

    // Re-track w1 (as a reload replay would).
    wm().trackWindow(ctx.display, w1);

    expect(commandSpy).not.toHaveBeenCalledWith(expect.objectContaining({ name: "Split" }));
    expect(ctx.tree.findNode(w0).parentNode).toBe(monitor);
  });
});
