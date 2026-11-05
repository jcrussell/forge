import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-5k24: with float-always-on-top-enabled, the float setter pins the
 * window (make_above + _forgeSetAbove). _floatsByRole read any is_above() as a
 * user "Always on Top" pin, so Forge's own pin kept the window floating (and
 * pinned) after the reason it was floated went away. The marker is kept on the
 * Meta.Window so it survives the node being rebuilt by a tree reload.
 */
describe("forge-5k24: Forge's float pin is not a user Always-on-Top pin", () => {
  let ctx;
  let win;
  let node;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "float-always-on-top-enabled": true } });
    win = createMockWindow({
      wm_class: "App1",
      id: 1001,
      title: "One",
      allows_resize: true,
      workspace: ctx.workspaces[0],
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("re-tiles and unpins a window once its float rule is removed", () => {
    ctx.configMgr.windowProps.overrides = [{ wmClass: "App1", mode: "float" }];
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);
    expect(win.is_above()).toBe(true);

    ctx.configMgr.windowProps.overrides = [];
    ctx.windowManager.processFloats();
    expect(node.isTile()).toBe(true);
    expect(win.is_above()).toBe(false);
  });

  it("re-tiles and unpins a window after its node is rebuilt", () => {
    ctx.configMgr.windowProps.overrides = [{ wmClass: "App1", mode: "float" }];
    ctx.windowManager.processFloats();
    expect(win.is_above()).toBe(true);

    // A tree reload drops every node and re-tracks the windows as new FLOAT nodes.
    ctx.tree.removeNode(node);
    const { monitor } = getWorkspaceAndMonitor(ctx);
    node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win, WINDOW_MODES.FLOAT);

    ctx.configMgr.windowProps.overrides = [];
    ctx.windowManager.processFloats();
    expect(node.isTile()).toBe(true);
    expect(win.is_above()).toBe(false);
  });

  it("re-tiles a class-less window once its class arrives", () => {
    win.set_wm_class(null);
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);

    win.set_wm_class("App1");
    ctx.windowManager.processFloats();
    expect(node.isTile()).toBe(true);
    expect(win.is_above()).toBe(false);
  });

  it("re-tiles a window when its workspace stops skipping tiling", () => {
    ctx.settings.set_string("workspace-skip-tile", "0");
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);

    ctx.settings.set_string("workspace-skip-tile", "");
    ctx.windowManager.processFloats();
    expect(node.isTile()).toBe(true);
    expect(win.is_above()).toBe(false);
  });

  it("keeps a user pin floating", () => {
    win.make_above();
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);
    expect(win._forgeSetAbove).toBeFalsy();
    ctx.windowManager.processFloats();
    expect(node.isFloat()).toBe(true);
  });
});
