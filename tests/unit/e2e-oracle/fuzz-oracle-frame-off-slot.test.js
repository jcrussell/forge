import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Node, NODE_TYPES } from "../../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Rectangle } from "../../mocks/gnome/Meta.js";

/**
 * The e2e fuzz oracle's frame rule (bridge.js fuzzFrameMismatch): a window Forge
 * tiles on the active workspace has its Mutter frame at the slot the render laid
 * out, unless Mutter owns the frame or the window cannot take the slot's size.
 */
const BRIDGE_JS = fileURLToPath(new URL("../../e2e/framework/bridge.js", import.meta.url));
const SLOT = { x: 0, y: 0, width: 960, height: 1080 };

describe("fuzz oracle: frame-off-slot", () => {
  let ctx;
  let bridge;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true, settings: { "tiling-mode-enabled": true } });
    ctx.extWm.tree = ctx.tree;
    ctx.extWm.findNodeWindow = (metaWindow) => ctx.tree.findNode(metaWindow);
    globalThis.Main = {
      extensionManager: {
        lookup: () => ({ stateObj: { extWm: ctx.extWm, settings: ctx.settings } }),
      },
    };
    // The frame probe touches none of the GI namespaces bridge.js captures at load.
    globalThis.imports = { gi: {} };
    // bridge.js is a GJS Eval script (an IIFE that installs globalThis._forgeTestBridge).
    (0, eval)(readFileSync(BRIDGE_JS, "utf8"));
    bridge = globalThis._forgeTestBridge;
  });

  afterEach(() => {
    ctx.cleanup();
    delete globalThis._forgeTestBridge;
    delete globalThis.Main;
    delete globalThis.imports;
  });

  // A tiled window laid out at SLOT whose frame is `frame`
  function tiled(frame, params = {}) {
    const metaWindow = createMockWindow({ rect: new Rectangle(frame), ...params });
    const node = new Node(NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    node.renderRect = { ...SLOT };
    getWorkspaceAndMonitor(ctx).monitor.appendChild(node);
    ctx.workspaces[0]._windows.push(metaWindow);
    return node;
  }

  const rules = () => JSON.parse(bridge.fuzzFrameMismatch()).violations.map((v) => v.rule);

  it("passes a frame at its slot", () => {
    tiled(SLOT);
    expect(rules()).toEqual([]);
  });

  it("flags a slot outside its monitor's work area", () => {
    const off = { ...SLOT, x: 1500 }; // the mock work area is 1920 wide
    tiled(off).renderRect = off;
    expect(rules()).toEqual(["slot-off-work-area"]);
  });

  it("flags a frame at the wrong position", () => {
    tiled({ ...SLOT, x: 960 });
    expect(rules()).toEqual(["frame-off-slot"]);
  });

  it("flags a frame smaller than its slot", () => {
    tiled({ ...SLOT, width: 400 });
    expect(rules()).toEqual(["frame-off-slot"]);
  });

  it("passes a frame held at a minimum size larger than its slot", () => {
    tiled({ ...SLOT, width: 1200 }, { size_hints: { min_width: 1200, min_height: 100 } });
    expect(rules()).toEqual([]);
  });

  it("flags a frame larger than both its slot and its minimum size", () => {
    tiled({ ...SLOT, width: 1200 }, { size_hints: { min_width: 1000, min_height: 100 } });
    expect(rules()).toEqual(["frame-off-slot"]);
  });

  it.each([
    ["minimized", { minimized: true }],
    ["fullscreen", { fullscreen: true }],
    ["maximized", { maximized_horizontally: true, maximized_vertically: true }],
    ["fixed-size", { allows_resize: false }],
  ])("skips a %s window", (_name, params) => {
    tiled({ ...SLOT, x: 500 }, params);
    expect(rules()).toEqual([]);
  });

  it("skips a floating window", () => {
    tiled({ ...SLOT, x: 500 }).mode = WINDOW_MODES.FLOAT;
    expect(rules()).toEqual([]);
  });

  it("reports nothing while tiling is off", () => {
    tiled({ ...SLOT, x: 500 });
    ctx.settings.set_boolean("tiling-mode-enabled", false);
    expect(rules()).toEqual([]);
  });

  it("reports only that Forge is busy while it has a render pending", () => {
    tiled({ ...SLOT, x: 500 });
    ctx.extWm._renderTreeSrcId = 7;
    expect(JSON.parse(bridge.fuzzFrameMismatch())).toEqual({ violations: [], busy: true });
  });

  it("reports that Forge is not busy once it has nothing pending", () => {
    tiled({ ...SLOT, x: 500 });
    expect(JSON.parse(bridge.fuzzFrameMismatch()).busy).toBe(false);
  });
});
