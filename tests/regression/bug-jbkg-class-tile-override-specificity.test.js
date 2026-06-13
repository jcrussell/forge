import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";
import { WindowType } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-jbkg: a class-only `tile` override short-circuited ALL floatByType
 * heuristics, force-tiling that class's dialogs/transients/non-resizable windows
 * (the bundled config ships bare class-only tile rules for Chrome, Evolution,
 * Anki, ...). The fix tracks override SPECIFICITY: explicit per-title/per-id
 * tile intent still always wins, but a bare class-only rule only tiles
 * NORMAL/resizable windows — dialogs of that class float by type.
 */
describe("Bug forge-jbkg: class-only tile override does not force-tile type-floats", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;
  const setOverrides = (overrides) => {
    wm().windowProps = { overrides };
  };

  it("floats a DIALOG of a class that has a bare class-only tile override", () => {
    setOverrides([{ wmClass: "evolution", mode: "tile" }]);
    const dialog = createMockWindow({
      wm_class: "evolution",
      title: "Send / Receive",
      window_type: WindowType.DIALOG,
    });
    expect(wm().isFloatingExempt(dialog)).toBe(true);
  });

  it("still tiles a NORMAL resizable window of that class (explicit class intent honored)", () => {
    setOverrides([{ wmClass: "evolution", mode: "tile" }]);
    const main = createMockWindow({
      wm_class: "evolution",
      title: "Inbox",
      window_type: WindowType.NORMAL,
      allows_resize: true,
    });
    expect(wm().isFloatingExempt(main)).toBe(false);
  });

  it("tiles even a dialog when a SPECIFIC (wmTitle) tile override targets it", () => {
    setOverrides([{ wmClass: "evolution", wmTitle: "Send / Receive", mode: "tile" }]);
    const dialog = createMockWindow({
      wm_class: "evolution",
      title: "Send / Receive",
      window_type: WindowType.DIALOG,
    });
    // Explicit per-title intent wins over float-by-type.
    expect(wm().isFloatingExempt(dialog)).toBe(false);
  });

  it("tiles even a dialog when a SPECIFIC (wmId) tile override targets it", () => {
    const dialog = createMockWindow({
      wm_class: "evolution",
      title: "Send / Receive",
      window_type: WindowType.DIALOG,
    });
    setOverrides([{ wmId: dialog.get_id(), mode: "tile" }]);
    expect(wm().isFloatingExempt(dialog)).toBe(false);
  });
});
