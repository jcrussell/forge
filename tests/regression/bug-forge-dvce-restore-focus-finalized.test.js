import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import Meta from "gi://Meta";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-dvce (audit-2026-07 / C9): _restoreFocusAfterWindowClosed reads
 * metaWindow.minimized then raise()/focus()/activate() on sibling wrappers, and the
 * workspace-candidate loop calls get_window_type(), all without Utils.isWindowAlive
 * — synchronous inside windowDestroy (pre-prune). A finalized sibling wrapper throws
 * on .minimized, aborting the rest of windowDestroy so focus is never restored.
 *
 * Fix: guard activate() and the candidate filter with Utils.isWindowAlive.
 */
describe("Bug forge-dvce: focus restore skips finalized siblings", () => {
  let ctx;
  const boom = () => {
    throw new Error("Object .Meta.Window has been already deallocated");
  };

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  it("skips a finalized sibling and still focuses a live one", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    const dead = createMockWindow({ id: 9401, workspace: ctx.workspaces[0] });
    dead.get_id = boom;
    Object.defineProperty(dead, "minimized", { configurable: true, get: boom });

    const live = createMockWindow({ id: 9402, workspace: ctx.workspaces[0] });
    let liveFocused = false;
    const realFocus = live.focus.bind(live);
    live.focus = (t) => {
      liveFocused = true;
      return realFocus(t);
    };

    // Dead sibling is visited first — before the fix its throw aborts the loop.
    const restore = {
      closedNodeWindow: { nodeValue: createMockWindow({ id: 9400 }) },
      siblings: [{ nodeValue: dead }, { nodeValue: live }],
      workspaceNode: ctx.tree.findAncestor(monitor, NODE_TYPES.WORKSPACE),
    };

    expect(() => ctx.windowManager._restoreFocusAfterWindowClosed(restore)).not.toThrow();
    expect(liveFocused).toBe(true);
  });
});
