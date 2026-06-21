import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WindowType } from "../mocks/gnome/Meta.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Dialog/popup z-order: a focused float (dialog included) is raised above the
 * tiled grid by raise-on-focus, NOT pinned always-on-top.
 *
 * Regression: `set float` used to call make_above() on every dialog/transient
 * regardless of the float-always-on-top-enabled setting (default false). That
 * global pin parked a popup in a higher stacking layer permanently, so clicking
 * a *sibling* floating window could never raise it above the popup — the popup
 * was "always on top". Dialogs now ride the normal layer and stay above tiles
 * via raise-on-focus, so focusing another float brings it forward.
 */
describe("Dialog z-order: focused float raises, no permanent always-on-top pin", () => {
  let ctx;

  beforeEach(() => {
    // float-always-on-top-enabled is FALSE (the default)
    ctx = createWindowManagerFixture({
      settings: { "float-always-on-top-enabled": false },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  describe("float setter does NOT pin dialogs when always-on-top is off", () => {
    it("does not make_above() a DIALOG window (it rides the normal layer)", () => {
      const dialog = createMockWindow({
        id: 2001,
        title: "Open File",
        window_type: WindowType.DIALOG,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dialog);

      nodeWindow.float = true;

      expect(dialog.is_above()).toBe(false);
      expect(nodeWindow._forgeSetAbove).toBeFalsy();
    });

    it("does not make_above() a MODAL_DIALOG window", () => {
      const modal = createMockWindow({
        id: 2002,
        title: "Save As",
        window_type: WindowType.MODAL_DIALOG,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, modal);

      nodeWindow.float = true;

      expect(modal.is_above()).toBe(false);
      expect(nodeWindow._forgeSetAbove).toBeFalsy();
    });

    it("does not make_above() a transient window", () => {
      const parent = createMockWindow({ id: 2010, title: "Parent App" });
      const transient = createMockWindow({
        id: 2003,
        title: "Preferences",
        window_type: WindowType.NORMAL,
        transient_for: parent,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, transient);

      nodeWindow.float = true;

      expect(transient.is_above()).toBe(false);
      expect(nodeWindow._forgeSetAbove).toBeFalsy();
    });

    it("does not make_above() a normal window", () => {
      const normal = createMockWindow({
        id: 2004,
        title: "Normal App",
        window_type: WindowType.NORMAL,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, normal);

      nodeWindow.float = true;

      expect(normal.is_above()).toBe(false);
      expect(nodeWindow._forgeSetAbove).toBeFalsy();
    });
  });

  describe("float setter still pins floats when always-on-top IS enabled", () => {
    beforeEach(() => {
      ctx.cleanup();
      ctx = createWindowManagerFixture({
        settings: { "float-always-on-top-enabled": true },
      });
    });

    it("make_above() a normal float when the user opted in", () => {
      const normal = createMockWindow({ id: 2100, title: "Always Float" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, normal);

      nodeWindow.float = true;

      expect(normal.is_above()).toBe(true);
      expect(nodeWindow._forgeSetAbove).toBe(true);
    });
  });

  describe("raise-on-focus brings the focused float to the front", () => {
    // The metaWindow "focus" signal queues a "raise-float" event; GLib timeouts
    // don't run under test, so capture and invoke the callback directly.
    function fireFocusAndGetRaiseFloat(metaWindow) {
      const captured = [];
      vi.spyOn(wm(), "queueEvent").mockImplementation((eventObj) => captured.push(eventObj));
      ctx.display.get_focus_window.mockReturnValue(metaWindow);
      metaWindow.emit("focus", metaWindow);
      return captured.find((e) => e.name === "raise-float");
    }

    it("raises a focused floating window instead of pinning it always-on-top", () => {
      // A transient is floating-exempt, so its freshly tracked node is FLOAT.
      const parent = createMockWindow({ id: 2200, title: "Parent", workspace: ctx.workspaces[0] });
      const popup = createMockWindow({
        id: 2201,
        title: "Popup",
        transient_for: parent,
        workspace: ctx.workspaces[0],
      });
      wm().trackWindow(null, popup);

      const raiseSpy = vi.spyOn(popup, "raise");
      const aboveSpy = vi.spyOn(popup, "make_above");

      const evt = fireFocusAndGetRaiseFloat(popup);
      expect(evt).toBeDefined();
      evt.callback();

      // Focused popup is raised above the tiled grid, never globally pinned.
      expect(raiseSpy).toHaveBeenCalled();
      expect(aboveSpy).not.toHaveBeenCalled();
      expect(popup.is_above()).toBe(false);
    });
  });

  describe("cleanupAlwaysFloat unpins every float, dialogs included", () => {
    it("removes is_above() from a dialog window (no dialog exception)", () => {
      const dialog = createMockWindow({
        id: 3001,
        title: "Open File",
        window_type: WindowType.DIALOG,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dialog);

      // Simulate the dialog having been pinned (e.g. always-on-top was on).
      dialog.make_above();
      nodeWindow.mode = WINDOW_MODES.FLOAT;
      expect(dialog.is_above()).toBe(true);

      wm().cleanupAlwaysFloat();
      expect(dialog.is_above()).toBe(false);
    });

    it("removes is_above() from normal floating windows", () => {
      const normal = createMockWindow({
        id: 3004,
        title: "Normal App",
        window_type: WindowType.NORMAL,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, normal);

      normal.make_above();
      nodeWindow.mode = WINDOW_MODES.FLOAT;
      expect(normal.is_above()).toBe(true);

      wm().cleanupAlwaysFloat();
      expect(normal.is_above()).toBe(false);
    });
  });
});
