import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";

/**
 * Bug forge-t1s9: the FloatToggle/FloatClassToggle command case reads
 * `existParent = focusNodeWindow.parentNode` then dereferences
 * existParent.childNodes with no null guard. The forge-ipga guard only covers a
 * missing/untracked focus window; a tracked-but-detached focus node (parentNode
 * null) still throws — inconsistent with WindowResetSizes, which guards.
 *
 * Fix: `if (!existParent) break;` after resolving existParent.
 */
describe("Bug forge-t1s9: FloatToggle guards a detached focus node's parent", () => {
  const FLOAT_ACTION = { mode: "float", x: "center", y: "center", width: 0.65, height: 0.75 };
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("does not throw when the resolved focus node has no parentNode", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const win = createMockWindow({ wm_class: "App", allows_resize: true });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    ctx.display.get_focus_window.mockReturnValue(win);

    // Simulate the node being detached (parentNode nulled) while still resolvable
    // as the focus node — the inconsistent state the guard defends against.
    node.parentNode = null;

    expect(() => ctx.windowManager.command({ name: "FloatToggle", ...FLOAT_ACTION })).not.toThrow();
  });
});
