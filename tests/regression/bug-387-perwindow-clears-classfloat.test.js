import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug #387 (forge-fxf): Super+c cannot re-tile a window floated via Super+Shift+c.
 *
 * Super+Shift+c (FloatClassToggle) writes a class-wide float override
 * {wmClass, mode:"float"} (no wmId). Super+c (FloatToggle) then called
 * removeFloatOverride(withWmId=true), which only matches per-window (wmId)
 * overrides — so the class float survived and the window stayed floating. The
 * per-window toggle was a no-op against a class float.
 *
 * Fix: toggleFloatingMode now uses per-window precedence. To tile a window that
 * floats only because of a class rule, it adds a per-window {wmClass, wmId,
 * mode:"tile"} override (highest precedence via hasTileOverride), tiling just
 * that window and leaving the class rule — and its siblings — untouched. The
 * toggle is reversible and never removes the class override (preserving the
 * bug-172 invariant).
 */
describe("Bug #387: per-window toggle re-tiles a class-floated window", () => {
  let ctx;
  let win;
  let node;
  const FLOAT_TOGGLE = { name: "FloatToggle" }; // Super+c (per-window)
  const CLASS_TOGGLE = { name: "FloatClassToggle" }; // Super+Shift+c (per-class)

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    win = createMockWindow({ wm_class: "TestApp", id: 3001, title: "Doc", allows_resize: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const overrides = () => ctx.configMgr.windowProps.overrides;

  it("re-tiles a class-floated window via a per-window tile override, leaving the class rule", () => {
    // Super+Shift+c: float the whole class.
    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win);
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(true);
    expect(overrides().some((o) => o.wmClass === "TestApp" && !o.wmId && o.mode === "float")).toBe(
      true
    );

    // Super+c: re-tile THIS window.
    ctx.windowManager.toggleFloatingMode(FLOAT_TOGGLE, win);

    // Now tiled (a per-window tile override wins)...
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(false);
    expect(
      overrides().some((o) => o.wmClass === "TestApp" && o.wmId === 3001 && o.mode === "tile")
    ).toBe(true);
    // ...but the class-wide float rule is untouched (siblings stay floated).
    expect(overrides().some((o) => o.wmClass === "TestApp" && !o.wmId && o.mode === "float")).toBe(
      true
    );
  });

  it("is reversible: a second Super+c floats it again, leaving no per-window tile residue", () => {
    ctx.windowManager.toggleFloatingMode(CLASS_TOGGLE, win); // class float
    ctx.windowManager.toggleFloatingMode(FLOAT_TOGGLE, win); // per-window tile
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(false);

    ctx.windowManager.toggleFloatingMode(FLOAT_TOGGLE, win); // back to floating

    expect(ctx.windowManager.isFloatingExempt(win)).toBe(true);
    expect(overrides().some((o) => o.mode === "tile")).toBe(false);
    // Class float rule still present.
    expect(overrides().some((o) => o.wmClass === "TestApp" && !o.wmId && o.mode === "float")).toBe(
      true
    );
  });

  it("plain per-window float toggle still works on an otherwise-tiled window", () => {
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(false);

    ctx.windowManager.toggleFloatingMode(FLOAT_TOGGLE, win); // float it
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(true);
    expect(overrides().some((o) => o.wmId === 3001 && o.mode === "float")).toBe(true);

    ctx.windowManager.toggleFloatingMode(FLOAT_TOGGLE, win); // tile it again
    expect(ctx.windowManager.isFloatingExempt(win)).toBe(false);
    expect(overrides().length).toBe(0);
  });
});
