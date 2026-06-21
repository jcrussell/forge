import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";

/**
 * Bug forge-9s8c: the SnapLayoutMove case body, including its terminating break,
 * sat entirely inside `if (focusNodeWindow)`. With no focus, no break ran and
 * execution fell through into the next case (ShowTabDecorationToggle) — masked
 * today only because that case early-returns on `!focusNodeWindow`, but one
 * reorder away from silently flipping the showtab-decoration GSetting on a
 * snap-layout keystroke.
 *
 * Fix: hoist `if (!focusNodeWindow) break;` to the top and break at the case's
 * outer scope so SnapLayoutMove never falls through. This is a structural
 * regression guard: it asserts the case is self-contained on the no-focus path.
 */
describe("Bug forge-9s8c: SnapLayoutMove does not fall through to the next case", () => {
  const SNAP_ACTION = { name: "SnapLayoutMove", direction: "left", amount: 0.5 };
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tabbed-tiling-mode-enabled": true } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("with no focused window: no throw and the showtab-decoration setting is untouched", () => {
    expect(ctx.display.get_focus_window()).toBeNull();
    const setSpy = vi.spyOn(ctx.settings, "set_boolean");

    expect(() => ctx.windowManager.command(SNAP_ACTION)).not.toThrow();

    // ShowTabDecorationToggle (the fall-through target) flips this setting; it
    // must never be written by a focus-less SnapLayoutMove.
    expect(setSpy).not.toHaveBeenCalledWith("showtab-decoration-enabled", expect.anything());
  });

  it("with a tracked window: snaps without touching the showtab-decoration setting", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const win = createMockWindow({ wm_class: "App", allows_resize: true });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    ctx.display.get_focus_window.mockReturnValue(win);
    const setSpy = vi.spyOn(ctx.settings, "set_boolean");

    expect(() => ctx.windowManager.command(SNAP_ACTION)).not.toThrow();
    expect(setSpy).not.toHaveBeenCalledWith("showtab-decoration-enabled", expect.anything());
  });
});
