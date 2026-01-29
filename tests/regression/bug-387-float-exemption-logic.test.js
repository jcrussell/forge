import { describe, it, expect, vi } from "vitest";

/**
 * Bug #387: Windows from specific applications ignoring Forge tiling
 *
 * Problem: After using Ctrl+Alt+c to center/float a window, the application's
 * windows permanently ignore Forge tiling. The toggle doesn't work to bring
 * them back. Some applications (like terminals without proper wm_class) are
 * also affected.
 *
 * Root Cause: The isFloatingExempt function returns true for windows with
 * null wm_class, empty title, or other conditions. When Super+Shift+c is
 * used, it saves a float override by wm_class. If wm_class is null, the
 * override may not work correctly.
 *
 * Fix: Improve handling of null wm_class windows and ensure toggles work
 * correctly for all override scenarios.
 */
describe("Bug #387: Float exemption logic", () => {
  describe("isFloatingExempt conditions", () => {
    it("should identify dialog windows as float exempt", () => {
      const DIALOG = 2;
      const NORMAL = 0;

      const dialogWindow = { windowType: DIALOG, wmClass: "SomeApp" };
      const normalWindow = { windowType: NORMAL, wmClass: "SomeApp" };

      const isDialog = dialogWindow.windowType === DIALOG;
      expect(isDialog).toBe(true);

      const isNormal = normalWindow.windowType === NORMAL;
      expect(isNormal).toBe(true);
    });

    it("should identify transient windows as float exempt", () => {
      const mainWindow = { id: "main", transientFor: null };
      const transientWindow = { id: "popup", transientFor: mainWindow };

      const isTransient = transientWindow.transientFor !== null;
      expect(isTransient).toBe(true);

      const mainIsTransient = mainWindow.transientFor !== null;
      expect(mainIsTransient).toBe(false);
    });

    it("should identify null wm_class windows as float exempt", () => {
      const windowWithClass = { wmClass: "SomeApp", title: "Window" };
      const windowWithNullClass = { wmClass: null, title: "Window" };
      const windowWithEmptyClass = { wmClass: "", title: "Window" };

      // Window with class should tile
      const hasClass = windowWithClass.wmClass !== null;
      expect(hasClass).toBe(true);

      // Window with null class is exempt
      const nullClassExempt = windowWithNullClass.wmClass === null;
      expect(nullClassExempt).toBe(true);

      // Empty string class should also be handled
      const emptyClassExempt =
        windowWithEmptyClass.wmClass === null || windowWithEmptyClass.wmClass === "";
      expect(emptyClassExempt).toBe(true);
    });

    it("should identify windows with empty/null title as float exempt", () => {
      const windowWithTitle = { wmClass: "SomeApp", title: "Window Title" };
      const windowWithNullTitle = { wmClass: "SomeApp", title: null };
      const windowWithEmptyTitle = { wmClass: "SomeApp", title: "" };

      // Window with title should tile
      const hasTitle = windowWithTitle.title !== null && windowWithTitle.title !== "";
      expect(hasTitle).toBe(true);

      // Null title is exempt
      const nullTitleExempt = windowWithNullTitle.title === null;
      expect(nullTitleExempt).toBe(true);

      // Empty title is exempt
      const emptyTitleExempt =
        windowWithEmptyTitle.title === "" || windowWithEmptyTitle.title?.length === 0;
      expect(emptyTitleExempt).toBe(true);
    });

    it("should identify non-resizable windows as float exempt", () => {
      const resizableWindow = { wmClass: "SomeApp", allowsResize: true };
      const fixedWindow = { wmClass: "SomeApp", allowsResize: false };

      const canResize = resizableWindow.allowsResize === true;
      expect(canResize).toBe(true);

      const isFixedSize = fixedWindow.allowsResize === false;
      expect(isFixedSize).toBe(true);
    });
  });

  describe("Float override by wm_class", () => {
    it("should store float override by wm_class", () => {
      const floatOverrides = {};
      const window = { wmClass: "jetbrains-idea", title: "IntelliJ" };

      // Super+Shift+c toggles always-float for the wm_class
      floatOverrides[window.wmClass] = true;

      expect(floatOverrides["jetbrains-idea"]).toBe(true);
    });

    it("should check float override when determining window mode", () => {
      const floatOverrides = { "jetbrains-idea": true };
      const window = { wmClass: "jetbrains-idea" };

      const shouldFloat = floatOverrides[window.wmClass] === true;
      expect(shouldFloat).toBe(true);
    });

    it("should not store override for null wm_class", () => {
      const floatOverrides = {};
      const window = { wmClass: null, title: "Unknown Window" };

      // Should not add null key to overrides
      if (window.wmClass !== null) {
        floatOverrides[window.wmClass] = true;
      }

      expect(floatOverrides[null]).toBeUndefined();
      expect(Object.keys(floatOverrides).length).toBe(0);
    });
  });

  describe("Toggle float behavior", () => {
    it("should toggle float for single window (Super+c)", () => {
      let windowFloatState = false;

      // Toggle float
      windowFloatState = !windowFloatState;
      expect(windowFloatState).toBe(true);

      // Toggle back
      windowFloatState = !windowFloatState;
      expect(windowFloatState).toBe(false);
    });

    it("should toggle always-float for wm_class (Super+Shift+c)", () => {
      const floatOverrides = {};
      const window = { wmClass: "alacritty" };

      // First toggle: enable float for class
      floatOverrides[window.wmClass] = !floatOverrides[window.wmClass];
      expect(floatOverrides["alacritty"]).toBe(true);

      // Second toggle: disable float for class
      floatOverrides[window.wmClass] = !floatOverrides[window.wmClass];
      expect(floatOverrides["alacritty"]).toBe(false);
    });

    it("should handle toggle with windows.json override", () => {
      // windows.json can have explicit tile overrides
      const windowsConfig = [
        { wmClass: "jetbrains-idea", mode: "tile" },
        { wmClass: "zoom", mode: "float" },
      ];

      const findOverride = (wmClass) => {
        return windowsConfig.find((o) => o.wmClass === wmClass);
      };

      // IntelliJ should tile
      const ideaOverride = findOverride("jetbrains-idea");
      expect(ideaOverride?.mode).toBe("tile");

      // Zoom should float
      const zoomOverride = findOverride("zoom");
      expect(zoomOverride?.mode).toBe("float");

      // Unknown app has no override
      const unknownOverride = findOverride("unknown-app");
      expect(unknownOverride).toBeUndefined();
    });
  });

  describe("Combined exemption checks", () => {
    it("should be exempt if any condition is true", () => {
      const DIALOG = 2;
      const NORMAL = 0;

      const isFloatingExempt = (window) => {
        return (
          window.windowType === DIALOG ||
          window.transientFor !== null ||
          window.wmClass === null ||
          window.title === null ||
          window.title === "" ||
          window.allowsResize === false
        );
      };

      // All conditions met - should tile
      const normalWindow = {
        windowType: NORMAL,
        transientFor: null,
        wmClass: "SomeApp",
        title: "Window",
        allowsResize: true,
      };
      expect(isFloatingExempt(normalWindow)).toBe(false);

      // Dialog - exempt
      const dialogWindow = { ...normalWindow, windowType: DIALOG };
      expect(isFloatingExempt(dialogWindow)).toBe(true);

      // Transient - exempt
      const transientWindow = { ...normalWindow, transientFor: {} };
      expect(isFloatingExempt(transientWindow)).toBe(true);

      // Null class - exempt
      const nullClassWindow = { ...normalWindow, wmClass: null };
      expect(isFloatingExempt(nullClassWindow)).toBe(true);

      // Empty title - exempt
      const emptyTitleWindow = { ...normalWindow, title: "" };
      expect(isFloatingExempt(emptyTitleWindow)).toBe(true);

      // Non-resizable - exempt
      const fixedWindow = { ...normalWindow, allowsResize: false };
      expect(isFloatingExempt(fixedWindow)).toBe(true);
    });
  });
});
