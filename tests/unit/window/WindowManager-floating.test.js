import { describe, it, expect, beforeEach, vi } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { WindowType } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager floating mode tests
 *
 * Tests for isFloatingExempt and toggleFloatingMode
 */
describe("WindowManager - Floating Mode", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  // Convenience accessors
  const wm = () => ctx.windowManager;
  const configMgr = () => ctx.configMgr;

  describe("isFloatingExempt - Type-based", () => {
    it("should float DIALOG windows", () => {
      const window = createMockWindow({ window_type: WindowType.DIALOG });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should float MODAL_DIALOG windows", () => {
      const window = createMockWindow({ window_type: WindowType.MODAL_DIALOG });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should NOT float NORMAL windows by type alone", () => {
      const window = createMockWindow({
        window_type: WindowType.NORMAL,
        wm_class: "TestApp",
        title: "Test Window",
        allows_resize: true,
      });

      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should float windows with transient parent", () => {
      const parentWindow = createMockWindow();
      const childWindow = createMockWindow({
        transient_for: parentWindow,
      });

      expect(wm().isFloatingExempt(childWindow)).toBe(true);
    });

    it("should float windows without wm_class", () => {
      const window = createMockWindow({ wm_class: null });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should float windows without title", () => {
      const window = createMockWindow({ title: null });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should float windows with empty title", () => {
      const window = createMockWindow({ title: "" });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should float windows that do not allow resize", () => {
      const window = createMockWindow({ allows_resize: false });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should return true for null window", () => {
      expect(wm().isFloatingExempt(null)).toBe(true);
    });
  });

  describe("isFloatingExempt - Override by wmClass", () => {
    it("should float windows matching wmClass override", () => {
      configMgr().windowProps.overrides = [{ wmClass: "Firefox", mode: "float" }];

      const window = createMockWindow({ wm_class: "Firefox", title: "Test", allows_resize: true });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should NOT float windows not matching wmClass override", () => {
      configMgr().windowProps.overrides = [{ wmClass: "Firefox", mode: "float" }];

      const window = createMockWindow({ wm_class: "Chrome", title: "Test", allows_resize: true });

      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should ignore tile mode overrides when checking float", () => {
      configMgr().windowProps.overrides = [{ wmClass: "Firefox", mode: "tile" }];

      const window = createMockWindow({ wm_class: "Firefox", title: "Test", allows_resize: true });

      expect(wm().isFloatingExempt(window)).toBe(false);
    });
  });

  describe("isFloatingExempt - Override by wmTitle", () => {
    it("should float windows matching wmTitle substring", () => {
      configMgr().windowProps.overrides = [
        { wmClass: "Firefox", wmTitle: "Private", mode: "float" },
      ];

      const window = createMockWindow({
        wm_class: "Firefox",
        title: "Mozilla Firefox Private Browsing",
        allows_resize: true,
      });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should NOT float windows not matching wmTitle", () => {
      configMgr().windowProps.overrides = [
        { wmClass: "Firefox", wmTitle: "Private", mode: "float" },
      ];

      const window = createMockWindow({
        wm_class: "Firefox",
        title: "Mozilla Firefox",
        allows_resize: true,
      });

      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should handle multiple titles in wmTitle (comma-separated)", () => {
      configMgr().windowProps.overrides = [
        { wmClass: "Code", wmTitle: "Settings,Preferences", mode: "float" },
      ];

      const window1 = createMockWindow({
        wm_class: "Code",
        title: "VS Code Settings",
        allows_resize: true,
      });

      const window2 = createMockWindow({
        wm_class: "Code",
        title: "VS Code Preferences",
        allows_resize: true,
      });

      expect(wm().isFloatingExempt(window1)).toBe(true);
      expect(wm().isFloatingExempt(window2)).toBe(true);
    });

    it("should handle negated title matching (!prefix)", () => {
      configMgr().windowProps.overrides = [
        { wmClass: "Terminal", wmTitle: "!root", mode: "float" },
      ];

      const window1 = createMockWindow({
        wm_class: "Terminal",
        title: "user@host",
        allows_resize: true,
      });

      const window2 = createMockWindow({
        wm_class: "Terminal",
        title: "root@host",
        allows_resize: true,
      });

      expect(wm().isFloatingExempt(window1)).toBe(true);
      expect(wm().isFloatingExempt(window2)).toBe(false);
    });

    it("should match exact single space title", () => {
      configMgr().windowProps.overrides = [{ wmClass: "Test", wmTitle: " ", mode: "float" }];

      const window1 = createMockWindow({
        wm_class: "Test",
        title: " ",
        allows_resize: true,
      });

      const window2 = createMockWindow({
        wm_class: "Test",
        title: "  ",
        allows_resize: true,
      });

      expect(wm().isFloatingExempt(window1)).toBe(true);
      expect(wm().isFloatingExempt(window2)).toBe(false);
    });
  });

  describe("isFloatingExempt - Override by wmId", () => {
    it("should float windows matching wmId and wmClass", () => {
      // Note: The implementation requires wmClass to be specified and match
      configMgr().windowProps.overrides = [{ wmId: 12345, wmClass: "TestApp", mode: "float" }];

      const window = createMockWindow({
        id: 12345,
        wm_class: "TestApp",
        title: "Test",
        allows_resize: true,
      });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should NOT float windows not matching wmId", () => {
      configMgr().windowProps.overrides = [{ wmId: 12345, mode: "float" }];

      const window = createMockWindow({ id: 67890, title: "Test", allows_resize: true });

      expect(wm().isFloatingExempt(window)).toBe(false);
    });
  });

  describe("isFloatingExempt - Combined Overrides", () => {
    it("should match when wmClass AND wmTitle both match", () => {
      configMgr().windowProps.overrides = [
        { wmClass: "Firefox", wmTitle: "Private", mode: "float" },
      ];

      const window = createMockWindow({
        wm_class: "Firefox",
        title: "Private Browsing",
        allows_resize: true,
      });

      expect(wm().isFloatingExempt(window)).toBe(true);
    });

    it("should NOT match when only wmClass matches", () => {
      configMgr().windowProps.overrides = [
        { wmClass: "Firefox", wmTitle: "Private", mode: "float" },
      ];

      const window = createMockWindow({
        wm_class: "Firefox",
        title: "Normal Browsing",
        allows_resize: true,
      });

      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should require wmClass to match even when wmId matches", () => {
      // The implementation requires wmClass to match - it's not optional
      configMgr().windowProps.overrides = [
        { wmId: 12345, wmClass: "Firefox", wmTitle: "Private", mode: "float" },
      ];

      const window = createMockWindow({
        id: 12345,
        wm_class: "Chrome", // Different class - won't match
        title: "Normal", // Different title
        allows_resize: true,
      });

      // wmClass must match, so this returns false
      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should handle multiple overrides", () => {
      // Note: wmClass MUST be specified and match for an override to work
      configMgr().windowProps.overrides = [
        { wmClass: "Firefox", mode: "float" },
        { wmClass: "Chrome", mode: "float" },
        { wmClass: "Calculator", wmTitle: "Calc", mode: "float" },
      ];

      const window1 = createMockWindow({ wm_class: "Firefox", title: "Test", allows_resize: true });
      const window2 = createMockWindow({ wm_class: "Chrome", title: "Test", allows_resize: true });
      const window3 = createMockWindow({
        wm_class: "Calculator",
        title: "Calc",
        allows_resize: true,
      });
      const window4 = createMockWindow({ wm_class: "Other", title: "Other", allows_resize: true });

      expect(wm().isFloatingExempt(window1)).toBe(true);
      expect(wm().isFloatingExempt(window2)).toBe(true);
      expect(wm().isFloatingExempt(window3)).toBe(true);
      expect(wm().isFloatingExempt(window4)).toBe(false);
    });
  });

  describe("isFloatingExempt - Explicit TILE Override (Bug #294)", () => {
    it("should NOT float when user explicitly sets TILE mode", () => {
      // Window that would normally float (no resize allowed)
      const window = createMockWindow({
        wm_class: "Neovide",
        title: "Neovide",
        allows_resize: false, // Would normally float
      });

      // But user has explicitly set it to tile
      configMgr().windowProps.overrides = [{ wmClass: "Neovide", mode: "tile" }];

      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should respect TILE override even with float-by-class rule", () => {
      // Window matches a float rule by class
      configMgr().windowProps.overrides = [
        { wmClass: "CustomApp", mode: "float" },
        { wmClass: "CustomApp", mode: "tile" }, // User later adds tile override
      ];

      const window = createMockWindow({
        wm_class: "CustomApp",
        title: "Test",
        allows_resize: true,
      });

      // TILE override should take precedence
      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should respect TILE override with wmTitle match", () => {
      configMgr().windowProps.overrides = [{ wmClass: "Terminal", wmTitle: "vim", mode: "tile" }];

      const window = createMockWindow({
        wm_class: "Terminal",
        title: "vim - file.txt",
        allows_resize: false, // Would normally float
      });

      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should respect TILE override with wmId match", () => {
      configMgr().windowProps.overrides = [{ wmClass: "App", wmId: 12345, mode: "tile" }];

      const window = createMockWindow({
        id: 12345,
        wm_class: "App",
        title: "App Window",
        allows_resize: false, // Would normally float
      });

      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should still float when TILE override wmTitle does not match", () => {
      configMgr().windowProps.overrides = [{ wmClass: "Terminal", wmTitle: "vim", mode: "tile" }];

      const window = createMockWindow({
        wm_class: "Terminal",
        title: "bash", // Different title
        allows_resize: false, // Would normally float
      });

      // No matching tile override, so floats due to allows_resize=false
      expect(wm().isFloatingExempt(window)).toBe(true);
    });
  });

  describe("isFloatingExempt - Built-in Float Rules", () => {
    describe("Firefox Picture-in-Picture (Bug #383)", () => {
      it("should float Firefox PIP windows", () => {
        const window = createMockWindow({
          wm_class: "Firefox",
          title: "Picture-in-Picture",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should float PIP windows case-insensitively", () => {
        const window = createMockWindow({
          wm_class: "Firefox",
          title: "PICTURE-IN-PICTURE",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should float PIP windows with additional title text", () => {
        const window = createMockWindow({
          wm_class: "Firefox",
          title: "Video - Picture-in-Picture - YouTube",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should allow TILE override to beat PIP float rule", () => {
        configMgr().windowProps.overrides = [
          { wmClass: "Firefox", wmTitle: "Picture-in-Picture", mode: "tile" },
        ];

        const window = createMockWindow({
          wm_class: "Firefox",
          title: "Picture-in-Picture",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(false);
      });
    });

    describe("Blender (Bug #260)", () => {
      it("should float Blender windows", () => {
        const window = createMockWindow({
          wm_class: "Blender",
          title: "Blender",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should float Blender windows case-insensitively", () => {
        const window = createMockWindow({
          wm_class: "blender",
          title: "Project.blend",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should float Blender subwindows", () => {
        const window = createMockWindow({
          wm_class: "Blender-bin",
          title: "Blender Preferences",
          allows_resize: true,
        });

        // wmClass contains "blender"
        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should allow TILE override to beat Blender float rule", () => {
        configMgr().windowProps.overrides = [{ wmClass: "Blender", mode: "tile" }];

        const window = createMockWindow({
          wm_class: "Blender",
          title: "Blender",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(false);
      });
    });

    describe("Steam (Bug #271)", () => {
      it("should float Steam windows", () => {
        const window = createMockWindow({
          wm_class: "Steam",
          title: "Steam",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should float Steam windows case-insensitively", () => {
        const window = createMockWindow({
          wm_class: "steam",
          title: "Steam Library",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should float steamwebhelper windows", () => {
        const window = createMockWindow({
          wm_class: "steamwebhelper",
          title: "Steam Web Browser",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should float Steam game overlay windows", () => {
        const window = createMockWindow({
          wm_class: "Steam-overlay",
          title: "Steam Overlay",
          allows_resize: true,
        });

        // wmClass contains "steam"
        expect(wm().isFloatingExempt(window)).toBe(true);
      });

      it("should allow TILE override to beat Steam float rule", () => {
        configMgr().windowProps.overrides = [{ wmClass: "Steam", mode: "tile" }];

        const window = createMockWindow({
          wm_class: "Steam",
          title: "Steam",
          allows_resize: true,
        });

        expect(wm().isFloatingExempt(window)).toBe(false);
      });
    });
  });

  describe("isFloatingExempt - User Can Override Auto-Float Apps", () => {
    it("should allow manual tiling of auto-float apps after user sets tile mode", () => {
      // Start with window that auto-floats (Blender)
      const window = createMockWindow({
        wm_class: "Blender",
        title: "Blender",
        allows_resize: true,
      });

      // Initially floats
      expect(wm().isFloatingExempt(window)).toBe(true);

      // User adds tile override
      configMgr().windowProps.overrides = [{ wmClass: "Blender", mode: "tile" }];

      // Now it tiles
      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should allow specific window instance override via wmId", () => {
      // Two Blender windows, only one should be tiled
      const window1 = createMockWindow({
        id: 111,
        wm_class: "Blender",
        title: "Blender - Main",
        allows_resize: true,
      });

      const window2 = createMockWindow({
        id: 222,
        wm_class: "Blender",
        title: "Blender - Secondary",
        allows_resize: true,
      });

      // Override only window1 to tile
      configMgr().windowProps.overrides = [{ wmClass: "Blender", wmId: 111, mode: "tile" }];

      expect(wm().isFloatingExempt(window1)).toBe(false); // Tiled
      expect(wm().isFloatingExempt(window2)).toBe(true); // Still floats
    });
  });

  describe("toggleFloatingMode", () => {
    let metaWindow;
    let nodeWindow;

    beforeEach(() => {
      metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test Window",
        allows_resize: true,
      });

      // Add window to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      nodeWindow.mode = WINDOW_MODES.TILE;

      ctx.display.get_focus_window.mockReturnValue(metaWindow);
    });

    it("should toggle from tile to float", () => {
      const action = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };

      wm().toggleFloatingMode(action, metaWindow);

      expect(nodeWindow.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should add float override when toggling to float", () => {
      const action = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };
      const addSpy = vi.spyOn(wm(), "addFloatOverride");

      wm().toggleFloatingMode(action, metaWindow);

      expect(addSpy).toHaveBeenCalledWith(metaWindow, true);
    });

    it("should toggle from float to tile when override exists", () => {
      nodeWindow.mode = WINDOW_MODES.FLOAT;
      configMgr().windowProps.overrides = [{ wmClass: "TestApp", mode: "float" }];

      const action = { name: "FloatToggle", mode: WINDOW_MODES.TILE };

      wm().toggleFloatingMode(action, metaWindow);

      expect(nodeWindow.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should remove float override when toggling from float", () => {
      nodeWindow.mode = WINDOW_MODES.FLOAT;
      configMgr().windowProps.overrides = [{ wmClass: "TestApp", mode: "float" }];

      const action = { name: "FloatToggle", mode: WINDOW_MODES.TILE };
      const removeSpy = vi.spyOn(wm(), "removeFloatOverride");

      wm().toggleFloatingMode(action, metaWindow);

      expect(removeSpy).toHaveBeenCalledWith(metaWindow, true);
    });

    it("should handle FloatClassToggle action", () => {
      const action = { name: "FloatClassToggle", mode: WINDOW_MODES.FLOAT };
      const addSpy = vi.spyOn(wm(), "addFloatOverride");

      wm().toggleFloatingMode(action, metaWindow);

      expect(addSpy).toHaveBeenCalledWith(metaWindow, false);
    });

    it("should not toggle non-window nodes", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const action = { name: "FloatToggle", mode: WINDOW_MODES.FLOAT };

      const modeBefore = monitor.mode;
      wm().toggleFloatingMode(action, monitor.nodeValue);

      // Should not change
      expect(monitor.mode).toBe(modeBefore);
    });
  });

  describe("findNodeWindow", () => {
    it("should find window in tree", () => {
      const metaWindow = createMockWindow();
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const found = wm().findNodeWindow(metaWindow);

      expect(found).toBe(nodeWindow);
    });

    it("should return null for window not in tree", () => {
      const metaWindow = createMockWindow();

      const found = wm().findNodeWindow(metaWindow);

      expect(found).toBeNull();
    });
  });

  describe("Override Management", () => {
    describe("addFloatOverride", () => {
      it("should add new float override by wmClass", () => {
        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        const initialLength = configMgr().windowProps.overrides.length;

        wm().addFloatOverride(metaWindow, false);

        const overrides = configMgr().windowProps.overrides;
        expect(overrides.length).toBe(initialLength + 1);
        expect(overrides[overrides.length - 1]).toEqual({
          wmClass: "TestApp",
          wmId: undefined,
          mode: "float",
        });
      });

      it("should add new float override with wmId when requested", () => {
        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().addFloatOverride(metaWindow, true);

        const overrides = configMgr().windowProps.overrides;
        const addedOverride = overrides[overrides.length - 1];
        expect(addedOverride.wmClass).toBe("TestApp");
        expect(addedOverride.wmId).toBe(123);
        expect(addedOverride.mode).toBe("float");
      });

      it("should not add duplicate override for same wmClass without wmId", () => {
        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().addFloatOverride(metaWindow, false);
        const lengthAfterFirst = configMgr().windowProps.overrides.length;

        wm().addFloatOverride(metaWindow, false);
        const lengthAfterSecond = configMgr().windowProps.overrides.length;

        expect(lengthAfterSecond).toBe(lengthAfterFirst);
      });

      it("should allow multiple instances with different wmIds", () => {
        const metaWindow1 = createMockWindow({ wm_class: "TestApp", id: 123 });
        const metaWindow2 = createMockWindow({ wm_class: "TestApp", id: 456 });

        wm().addFloatOverride(metaWindow1, true);
        const lengthAfterFirst = configMgr().windowProps.overrides.length;

        wm().addFloatOverride(metaWindow2, true);
        const lengthAfterSecond = configMgr().windowProps.overrides.length;

        expect(lengthAfterSecond).toBe(lengthAfterFirst + 1);
      });

      it("should not add duplicate when wmId matches existing override", () => {
        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().addFloatOverride(metaWindow, true);
        const lengthAfterFirst = configMgr().windowProps.overrides.length;

        wm().addFloatOverride(metaWindow, true);
        const lengthAfterSecond = configMgr().windowProps.overrides.length;

        expect(lengthAfterSecond).toBe(lengthAfterFirst);
      });

      it("should ignore overrides with wmTitle when checking duplicates", () => {
        configMgr().windowProps.overrides = [
          { wmClass: "TestApp", wmTitle: "Something", mode: "float" },
        ];

        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().addFloatOverride(metaWindow, false);

        const overrides = configMgr().windowProps.overrides;
        expect(overrides.length).toBe(2); // Both should exist
      });

      it("should update windowProps on WindowManager instance", () => {
        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().addFloatOverride(metaWindow, false);

        expect(wm().windowProps).toBe(configMgr().windowProps);
      });
    });

    describe("removeFloatOverride", () => {
      beforeEach(() => {
        // Reset overrides before each test
        configMgr().windowProps.overrides = [];
      });

      it("should remove float override by wmClass", () => {
        configMgr().windowProps.overrides = [
          { wmClass: "TestApp", mode: "float" },
          { wmClass: "OtherApp", mode: "float" },
        ];

        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().removeFloatOverride(metaWindow, false);

        const overrides = configMgr().windowProps.overrides;
        expect(overrides.length).toBe(1);
        expect(overrides[0].wmClass).toBe("OtherApp");
      });

      it("should remove float override by wmClass and wmId when requested", () => {
        configMgr().windowProps.overrides = [
          { wmClass: "TestApp", wmId: 123, mode: "float" },
          { wmClass: "TestApp", wmId: 456, mode: "float" },
        ];

        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().removeFloatOverride(metaWindow, true);

        const overrides = configMgr().windowProps.overrides;
        expect(overrides.length).toBe(1);
        expect(overrides[0].wmId).toBe(456);
      });

      it("should not remove overrides with wmTitle (user-defined)", () => {
        configMgr().windowProps.overrides = [
          { wmClass: "TestApp", wmTitle: "UserRule", mode: "float" },
          { wmClass: "TestApp", mode: "float" },
        ];

        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().removeFloatOverride(metaWindow, false);

        const overrides = configMgr().windowProps.overrides;
        expect(overrides.length).toBe(1);
        expect(overrides[0].wmTitle).toBe("UserRule");
      });

      it("should handle non-existent override gracefully", () => {
        configMgr().windowProps.overrides = [{ wmClass: "OtherApp", mode: "float" }];

        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        expect(() => {
          wm().removeFloatOverride(metaWindow, false);
        }).not.toThrow();

        expect(configMgr().windowProps.overrides.length).toBe(1);
      });

      it("should remove all matching overrides without wmId filter", () => {
        configMgr().windowProps.overrides = [
          { wmClass: "TestApp", mode: "float" },
          { wmClass: "TestApp", wmId: 123, mode: "float" },
          { wmClass: "TestApp", wmId: 456, mode: "float" },
        ];

        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().removeFloatOverride(metaWindow, false);

        const overrides = configMgr().windowProps.overrides;
        expect(overrides.length).toBe(0);
      });

      it("should only remove matching wmId when wmId filter enabled", () => {
        configMgr().windowProps.overrides = [
          { wmClass: "TestApp", mode: "float" },
          { wmClass: "TestApp", wmId: 123, mode: "float" },
          { wmClass: "TestApp", wmId: 456, mode: "float" },
        ];

        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().removeFloatOverride(metaWindow, true);

        const overrides = configMgr().windowProps.overrides;
        expect(overrides.length).toBe(2);
        expect(overrides.some((o) => o.wmId === 123)).toBe(false);
      });

      it("should update windowProps on WindowManager instance", () => {
        configMgr().windowProps.overrides = [{ wmClass: "TestApp", mode: "float" }];

        const metaWindow = createMockWindow({ wm_class: "TestApp", id: 123 });

        wm().removeFloatOverride(metaWindow, false);

        expect(wm().windowProps).toBe(configMgr().windowProps);
      });
    });

    describe("reloadWindowOverrides", () => {
      it("should reload overrides from ConfigManager", () => {
        const newOverrides = [
          { wmClass: "App1", mode: "float" },
          { wmClass: "App2", mode: "tile" },
        ];

        configMgr().windowProps.overrides = newOverrides;

        wm().reloadWindowOverrides();

        expect(wm().windowProps.overrides.length).toBe(2);
      });

      it("should filter out wmId-based overrides", () => {
        configMgr().windowProps.overrides = [
          { wmClass: "App1", mode: "float" },
          { wmClass: "App2", wmId: 123, mode: "float" },
          { wmClass: "App3", mode: "tile" },
        ];

        wm().reloadWindowOverrides();

        const overrides = wm().windowProps.overrides;
        expect(overrides.length).toBe(2);
        expect(overrides.some((o) => o.wmId !== undefined)).toBe(false);
      });

      it("should preserve wmTitle-based overrides", () => {
        configMgr().windowProps.overrides = [
          { wmClass: "App1", wmTitle: "Test", mode: "float" },
          { wmClass: "App2", wmId: 123, mode: "float" },
        ];

        wm().reloadWindowOverrides();

        const overrides = wm().windowProps.overrides;
        expect(overrides.length).toBe(1);
        expect(overrides[0].wmTitle).toBe("Test");
      });

      it("should handle empty overrides array", () => {
        configMgr().windowProps.overrides = [];

        wm().reloadWindowOverrides();

        expect(wm().windowProps.overrides.length).toBe(0);
      });

      it("should update windowProps reference", () => {
        const freshProps = { overrides: [{ wmClass: "Test", mode: "float" }] };
        configMgr().windowProps = freshProps;

        wm().reloadWindowOverrides();

        expect(wm().windowProps).toBe(freshProps);
      });
    });
  });
});
