import { describe, it, expect, beforeEach } from "vitest";
import { Keybindings } from "../../lib/extension/keybindings.js";

/**
 * Bug forge-3ilf (audit-2026-07 / C12): the "Shift" drag-tile modifier compared the
 * pointer modifier state to 2 / 258, but Clutter/X11 SHIFT_MASK is 1<<0 = 1 (with the
 * pointer-grabbed bit 256 -> 257). The value 2 is LOCK_MASK (Caps Lock). So holding
 * Shift while dragging (state 257 = SHIFT|BUTTON1) never triggered tiling, while
 * latching Caps Lock (state 258) wrongly did.
 *
 * Root cause: keybindings.js allowDragDropTile() "Shift" case used 2 / 258.
 * Fix: use 1 / 257 (SHIFT_MASK / SHIFT_MASK|grabbed), matching Ctrl=4, Alt=8, Super=64.
 */
describe("Bug forge-3ilf: Shift drag-tile modifier uses SHIFT_MASK (1/257)", () => {
  let keybindings;
  let mockExt;

  beforeEach(() => {
    mockExt = {
      extWm: {
        command: () => {},
        getPointer: () => [0, 0, 0],
      },
      kbdSettings: {
        get_string: () => "Shift",
        get_strv: () => [],
      },
      settings: {
        get_uint: () => 10,
        get_string: () => "",
        get_boolean: () => false,
      },
    };
    keybindings = new Keybindings(mockExt);
  });

  const withState = (state) => {
    mockExt.extWm.getPointer = () => [0, 0, state];
  };

  it("allows tiling when Shift is held (SHIFT_MASK = 1)", () => {
    withState(1);
    expect(keybindings.allowDragDropTile()).toBe(true);
  });

  it("allows tiling when Shift is held during a pointer grab (1 + 256 = 257)", () => {
    withState(257);
    expect(keybindings.allowDragDropTile()).toBe(true);
  });

  it("does NOT tile on Caps Lock alone (LOCK_MASK = 2)", () => {
    withState(2);
    expect(keybindings.allowDragDropTile()).toBe(false);
  });

  it("does NOT tile on Caps Lock during a grab (2 + 256 = 258)", () => {
    withState(258);
    expect(keybindings.allowDragDropTile()).toBe(false);
  });
});
