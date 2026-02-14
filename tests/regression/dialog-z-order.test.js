import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WindowType } from "../mocks/gnome/Meta.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Dialog/popup z-order: Dialogs should always be above tiled windows
 *
 * Problem: File chooser dialogs and other transient/popup windows appear behind
 * tiled windows because make_above() is only called when float-always-on-top-enabled
 * is true (default: false). Dialogs/transients should always be raised regardless
 * of that setting.
 */
describe("Dialog z-order: always raise dialogs above tiled windows", () => {
  let ctx;

  beforeEach(() => {
    // float-always-on-top-enabled is FALSE (the default)
    ctx = createWindowManagerFixture({
      settings: { "float-always-on-top-enabled": false },
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("float setter raises dialogs regardless of setting", () => {
    it("should make_above() a DIALOG window even when float-always-on-top is false", () => {
      const dialog = createMockWindow({
        id: 2001,
        title: "Open File",
        window_type: WindowType.DIALOG,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dialog);

      nodeWindow.float = true;

      expect(dialog.is_above()).toBe(true);
      expect(nodeWindow._forgeSetAbove).toBe(true);
    });

    it("should make_above() a MODAL_DIALOG window even when float-always-on-top is false", () => {
      const modal = createMockWindow({
        id: 2002,
        title: "Save As",
        window_type: WindowType.MODAL_DIALOG,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, modal);

      nodeWindow.float = true;

      expect(modal.is_above()).toBe(true);
      expect(nodeWindow._forgeSetAbove).toBe(true);
    });

    it("should make_above() a transient window even when float-always-on-top is false", () => {
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

      expect(transient.is_above()).toBe(true);
      expect(nodeWindow._forgeSetAbove).toBe(true);
    });

    it("should NOT make_above() a normal window when float-always-on-top is false", () => {
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

  describe("cleanupAlwaysFloat preserves dialog z-order", () => {
    it("should NOT remove is_above() from dialog windows", () => {
      const dialog = createMockWindow({
        id: 3001,
        title: "Open File",
        window_type: WindowType.DIALOG,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dialog);

      // Float the dialog (will be raised due to isDialog check)
      nodeWindow.float = true;
      expect(dialog.is_above()).toBe(true);

      // cleanupAlwaysFloat should skip dialogs
      ctx.windowManager.cleanupAlwaysFloat();
      expect(dialog.is_above()).toBe(true);
    });

    it("should NOT remove is_above() from modal dialog windows", () => {
      const modal = createMockWindow({
        id: 3002,
        title: "Save As",
        window_type: WindowType.MODAL_DIALOG,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, modal);

      nodeWindow.float = true;
      expect(modal.is_above()).toBe(true);

      ctx.windowManager.cleanupAlwaysFloat();
      expect(modal.is_above()).toBe(true);
    });

    it("should NOT remove is_above() from transient windows", () => {
      const parent = createMockWindow({ id: 3010, title: "Parent" });
      const transient = createMockWindow({
        id: 3003,
        title: "Preferences",
        window_type: WindowType.NORMAL,
        transient_for: parent,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, transient);

      nodeWindow.float = true;
      expect(transient.is_above()).toBe(true);

      ctx.windowManager.cleanupAlwaysFloat();
      expect(transient.is_above()).toBe(true);
    });

    it("should remove is_above() from normal floating windows", () => {
      const normal = createMockWindow({
        id: 3004,
        title: "Normal App",
        window_type: WindowType.NORMAL,
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, normal);

      // Manually set above to simulate float-always-on-top having been enabled previously
      normal.make_above();
      nodeWindow.mode = WINDOW_MODES.FLOAT;
      expect(normal.is_above()).toBe(true);

      ctx.windowManager.cleanupAlwaysFloat();
      expect(normal.is_above()).toBe(false);
    });
  });
});
