import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CommandHandler } from "../../lib/extension/command.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import {
  createMockWindow,
  installGnomeGlobals,
  createMockSettings,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-l4pd (audit-2026-07 / C13): LayoutStackedToggle / LayoutTabbedToggle call
 * tree.split(node, HORIZONTAL, true) when the focus node's parent is the MONITOR node,
 * but tree.split() returns null for a FLOAT node (no container is created). The handlers
 * ignored that null and went on to stamp `parentNode.layout = STACKED/TABBED` onto the
 * MONITOR node — sticky corruption: every window later opened on that monitor renders
 * stacked/tabbed with no keybinding to recover.
 *
 * Fix: mirror the Split handler (forge-clsp) — bail when split() returns null so the
 * monitor node's layout is never touched.
 */
describe("Bug forge-l4pd: layout toggle on a float under the monitor must not stamp the monitor", () => {
  let commandHandler;
  let mockWm;
  let monitorNode;
  let ctx;

  beforeEach(() => {
    ctx = installGnomeGlobals();

    const settings = createMockSettings({
      "stacked-tiling-mode-enabled": true,
      "tabbed-tiling-mode-enabled": true,
    });

    // Focus node is a FLOAT window whose direct parent is the MONITOR node.
    monitorNode = {
      layout: LAYOUT_TYPES.HSPLIT,
      isMonitor: () => true,
      lastChild: null,
      lastTabFocus: null,
    };
    const focusNodeWindow = {
      nodeValue: createMockWindow({ wm_class: "FloatApp" }),
      nodeType: NODE_TYPES.WINDOW,
      mode: WINDOW_MODES.FLOAT,
      parentNode: monitorNode,
    };
    monitorNode.lastChild = focusNodeWindow;

    mockWm = {
      ext: { settings },
      focusMetaWindow: focusNodeWindow.nodeValue,
      findNodeWindow: () => focusNodeWindow,
      determineSplitLayout: () => LAYOUT_TYPES.HSPLIT,
      unfreezeRender: vi.fn(),
      renderTree: vi.fn(),
      tree: {
        // split() returns null for a FLOAT node (tree.js), simulated here.
        split: vi.fn(() => null),
        resetSiblingPercent: vi.fn(),
        attachNode: null,
      },
    };
    commandHandler = new CommandHandler(mockWm);
  });

  afterEach(() => ctx.cleanup());

  it("LayoutStackedToggle leaves the monitor node layout unchanged", () => {
    commandHandler.execute({ name: "LayoutStackedToggle" });
    expect(monitorNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(monitorNode.layout).not.toBe(LAYOUT_TYPES.STACKED);
  });

  it("LayoutTabbedToggle leaves the monitor node layout unchanged", () => {
    commandHandler.execute({ name: "LayoutTabbedToggle" });
    expect(monitorNode.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(monitorNode.layout).not.toBe(LAYOUT_TYPES.TABBED);
  });
});
