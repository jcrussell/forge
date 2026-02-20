import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keybindings } from "../../../lib/extension/keybindings.js";

/**
 * Keybindings behavioral tests
 *
 * Tests for allowDragDropTile() which determines whether a window drag should
 * trigger tiling based on the configured modifier key and current modifier state.
 * Uses Clutter modifier bitmask values: Super=64, Alt=8, Ctrl=4, grabbed=256.
 */
describe("Keybindings", () => {
  let keybindings;
  let mockExt;

  beforeEach(() => {
    mockExt = {
      extWm: {
        command: vi.fn(),
        getPointer: vi.fn(() => [0, 0, 0]),
      },
      kbdSettings: {
        get_string: vi.fn(() => "Super"),
        get_strv: vi.fn(() => []),
      },
      settings: {
        get_uint: vi.fn(() => 10),
        get_string: vi.fn(() => ""),
      },
    };

    keybindings = new Keybindings(mockExt);
  });

  describe("allowDragDropTile()", () => {
    describe("Super modifier", () => {
      beforeEach(() => {
        mockExt.kbdSettings.get_string.mockReturnValue("Super");
      });

      it("should allow tiling when Super is held (state=64)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should allow tiling when Super+grabbed (state=320)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 320]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should not allow tiling with no modifier (state=0)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Alt is held instead (state=8)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 8]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Ctrl is held instead (state=4)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 4]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });
    });

    describe("Alt modifier", () => {
      beforeEach(() => {
        mockExt.kbdSettings.get_string.mockReturnValue("Alt");
      });

      it("should allow tiling when Alt is held (state=8)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 8]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should allow tiling when Alt+grabbed (state=264)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 264]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should not allow tiling with no modifier (state=0)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Super is held instead (state=64)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Ctrl is held instead (state=4)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 4]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });
    });

    describe("Ctrl modifier", () => {
      beforeEach(() => {
        mockExt.kbdSettings.get_string.mockReturnValue("Ctrl");
      });

      it("should allow tiling when Ctrl is held (state=4)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 4]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should allow tiling when Ctrl+grabbed (state=260)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 260]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should not allow tiling with no modifier (state=0)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Super is held instead (state=64)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling when Alt is held instead (state=8)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 8]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });
    });

    describe("None modifier", () => {
      beforeEach(() => {
        mockExt.kbdSettings.get_string.mockReturnValue("None");
      });

      it("should always allow tiling regardless of state (state=0)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should always allow tiling regardless of state (state=64)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });

      it("should always allow tiling regardless of state (state=256)", () => {
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 256]);
        expect(keybindings.allowDragDropTile()).toBe(true);
      });
    });

    describe("unknown modifier value", () => {
      it("should not allow tiling for an unknown modifier string", () => {
        mockExt.kbdSettings.get_string.mockReturnValue("Hyper");
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 64]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });

      it("should not allow tiling for empty modifier string", () => {
        mockExt.kbdSettings.get_string.mockReturnValue("");
        mockExt.extWm.getPointer.mockReturnValue([0, 0, 0]);
        expect(keybindings.allowDragDropTile()).toBe(false);
      });
    });
  });
});
