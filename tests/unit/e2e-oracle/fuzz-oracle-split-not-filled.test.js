import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";

/**
 * The e2e fuzz oracle's fill rule (bridge.js fuzzCheckInvariants, split-not-filled):
 * the tiled children of a split sit end to end along its axis, span the other
 * axis, and together reach the container's far edge.
 */
const BRIDGE_JS = fileURLToPath(new URL("../../e2e/framework/bridge.js", import.meta.url));

describe("fuzz oracle: split-not-filled", () => {
  let ctx;
  let bridge;
  let monitor;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    globalThis.Main = {
      extensionManager: { lookup: () => ({ stateObj: { extWm: { tree: ctx.tree } } }) },
    };
    // The tree walk touches none of the GI namespaces bridge.js captures at load.
    globalThis.imports = { gi: {} };
    // bridge.js is a GJS Eval script (an IIFE that installs globalThis._forgeTestBridge).
    (0, eval)(readFileSync(BRIDGE_JS, "utf8"));
    bridge = globalThis._forgeTestBridge;
    monitor = getWorkspaceAndMonitor(ctx).monitor;
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1000, height: 800 };
  });

  afterEach(() => {
    ctx.cleanup();
    delete globalThis._forgeTestBridge;
    delete globalThis.Main;
    delete globalThis.imports;
  });

  function tiled(rect, mode = WINDOW_MODES.TILE) {
    const node = new Node(NODE_TYPES.WINDOW, createMockWindow());
    node.mode = mode;
    node.rect = rect;
    monitor.appendChild(node);
    return node;
  }

  const fillRules = () =>
    JSON.parse(bridge.fuzzCheckInvariants({ render: false }))
      .violations.filter((v) => v.rule === "split-not-filled")
      .map((v) => v.detail);

  it("passes children that cover the split", () => {
    tiled({ x: 0, y: 0, width: 400, height: 800 });
    tiled({ x: 400, y: 0, width: 600, height: 800 });
    expect(fillRules()).toEqual([]);
  });

  it("passes a vertical split whose children cover it", () => {
    monitor.layout = LAYOUT_TYPES.VSPLIT;
    tiled({ x: 0, y: 0, width: 1000, height: 300 });
    tiled({ x: 0, y: 300, width: 1000, height: 500 });
    expect(fillRules()).toEqual([]);
  });

  it("ignores a floating child's stale rect", () => {
    tiled({ x: 0, y: 0, width: 1000, height: 800 });
    tiled({ x: 500, y: 0, width: 500, height: 800 }, WINDOW_MODES.FLOAT);
    expect(fillRules()).toEqual([]);
  });

  it.each([
    ["a hole between two children", { x: 0, width: 400 }, { x: 500, width: 500 }],
    ["two children that overlap", { x: 0, width: 600 }, { x: 400, width: 600 }],
    ["a last child short of the far edge", { x: 0, width: 400 }, { x: 400, width: 500 }],
    ["a last child past the far edge", { x: 0, width: 400 }, { x: 400, width: 700 }],
    ["a first child off the origin", { x: 10, width: 390 }, { x: 400, width: 600 }],
    [
      "a child that does not span the other axis",
      { x: 0, width: 400, height: 700 },
      { x: 400, width: 600 },
    ],
  ])("flags %s", (_name, first, second) => {
    tiled({ y: 0, height: 800, ...first });
    tiled({ y: 0, height: 800, ...second });
    expect(fillRules()).toHaveLength(1);
  });
});
