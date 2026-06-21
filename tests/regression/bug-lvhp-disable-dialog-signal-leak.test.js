import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WindowType } from "../mocks/gnome/Meta.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-lvhp: disable()'s signal-disconnect loop iterated
 * windowsAllWorkspaces (global.display.get_tab_list NORMAL_ALL), which excludes
 * DIALOG/MODAL_DIALOG by Mutter definition. But trackWindow connects
 * windowSignals/actorSignals to every VALID_WINDOW_TYPES window, dialogs
 * included — so a still-open tracked dialog was never visited and kept live
 * handlers bound to the disabled WindowManager (leaking across enable/disable
 * cycles).
 *
 * Fix: drive the disconnect loop off the union of windowsAllWorkspaces and the
 * tree's WINDOW nodes (which include dialogs).
 */
describe("Bug forge-lvhp: disable disconnects signals on tracked dialogs", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("disconnects a tracked DIALOG's signals even though the tab list excludes it", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const dialog = createMockWindow({
      id: 7001,
      title: "Save As",
      window_type: WindowType.MODAL_DIALOG,
    });
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, dialog);

    // Simulate trackWindow having connected a signal on the dialog.
    const sigId = dialog.connect("focus", () => {});
    dialog.windowSignals = [sigId];
    let disconnected = 0;
    const realDisconnect = dialog.disconnect.bind(dialog);
    dialog.disconnect = (id) => {
      disconnected++;
      return realDisconnect(id);
    };

    // Mutter's NORMAL_ALL tab list excludes dialogs: the union must still reach it.
    Object.defineProperty(ctx.windowManager, "windowsAllWorkspaces", {
      get: () => [],
      configurable: true,
    });

    ctx.windowManager._signalsBound = true;
    ctx.windowManager._removeSignals();

    expect(disconnected).toBeGreaterThan(0);
    expect(dialog.windowSignals).toBeUndefined();
  });
});
