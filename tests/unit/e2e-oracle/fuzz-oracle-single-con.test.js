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
import { Bin } from "../../mocks/gnome/St.js";

/**
 * forge-mfss: the e2e fuzz oracle (bridge.js fuzzCheckInvariants) flagged
 * STACKED[HSPLIT[..]] as con-single-con-child, but cleanTree keeps a stacked/tabbed
 * group whose only child is a split on purpose (forge-in5v). Closing W1 in
 * STACKED[W1, HSPLIT[W2, W3]] reaches that shape. The oracle must agree with
 * cleanTree's flatten rule: whatever cleanTree leaves is not a violation.
 */
const BRIDGE_JS = fileURLToPath(new URL("../../e2e/framework/bridge.js", import.meta.url));

describe("forge-mfss: fuzz oracle agrees with cleanTree's flatten rule", () => {
  let ctx;
  let bridge;

  beforeEach(() => {
    delete globalThis._forgeTestBridge;
  });

  afterEach(() => {
    ctx.cleanup();
    delete globalThis._forgeTestBridge;
    delete globalThis.Main;
    delete globalThis.imports;
  });

  function loadBridge() {
    globalThis.Main = {
      extensionManager: { lookup: () => ({ stateObj: { extWm: { tree: ctx.tree } } }) },
    };
    // The oracle walk below touches none of the GI namespaces bridge.js captures at load.
    globalThis.imports = { gi: {} };
    // bridge.js is a GJS Eval script (an IIFE that installs globalThis._forgeTestBridge).
    (0, eval)(readFileSync(BRIDGE_JS, "utf8"));
    return globalThis._forgeTestBridge;
  }

  function tileWin(id) {
    const node = new Node(NODE_TYPES.WINDOW, createMockWindow({ id }));
    node.settings = ctx.tree.settings;
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  function con(layout) {
    const node = new Node(NODE_TYPES.CON, new Bin());
    node.settings = ctx.tree.settings;
    node.layout = layout;
    return node;
  }

  const singleConRules = () =>
    JSON.parse(bridge.fuzzCheckInvariants({ render: false }))
      .violations.filter((v) => v.rule === "con-single-con-child")
      .map((v) => v.detail + " " + v.path);

  it.each([
    ["STACKED", true],
    ["TABBED", false],
  ])("%s[HSPLIT[W2, W3]] left by closing W1 is not a violation", (layout, autoExitTabbed) => {
    ctx = createTreeFixture({
      fullExtWm: true,
      settings: { "auto-exit-tabbed": autoExitTabbed },
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const group = con(LAYOUT_TYPES[layout]);
    monitor.appendChild(group);
    const w1 = tileWin(9101);
    group.appendChild(w1);
    const split = con(LAYOUT_TYPES.HSPLIT);
    group.appendChild(split);
    split.appendChild(tileWin(9102));
    split.appendChild(tileWin(9103));

    ctx.tree.removeNode(w1);
    ctx.tree.cleanTree();
    expect(group.childNodes).toEqual([split]); // cleanTree keeps it (forge-in5v)

    bridge = loadBridge();
    expect(singleConRules()).toEqual([]);
  });

  it("still flags a split CON wrapping a single CON (cleanTree would flatten it)", () => {
    ctx = createTreeFixture({ fullExtWm: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const outer = con(LAYOUT_TYPES.VSPLIT);
    monitor.appendChild(outer);
    const inner = con(LAYOUT_TYPES.STACKED);
    outer.appendChild(inner);
    inner.appendChild(tileWin(9201));
    inner.appendChild(tileWin(9202));

    bridge = loadBridge();
    expect(singleConRules()).toHaveLength(1);
  });
});
