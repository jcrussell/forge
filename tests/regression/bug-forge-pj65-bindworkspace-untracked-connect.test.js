import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";
import { Workspace } from "../mocks/gnome/Meta.js";

/**
 * Bug forge-pj65: bindWorkspaceSignals connected "window-added" UNCONDITIONALLY but
 * stored the signal id only when wsIndex >= 0. A workspace whose index() returns -1
 * (mid-removal/reorder during dynamic-workspace churn) got a handler connected on
 * the long-lived Meta.Workspace whose id was dropped on the floor — never
 * disconnected, surviving disable() and pinning the WindowManager.
 *
 * Fix: bail before connecting when wsIndex < 0, so no connect happens on the
 * untracked path.
 */
describe("Bug forge-pj65: no untracked connect on an index()<0 workspace", () => {
  let ctx, wsm;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    wsm = ctx.tree.workspaceManager;
  });

  afterEach(() => ctx.cleanup());

  it("does not connect (or leak) a handler when the workspace index is -1", () => {
    const orphan = new Workspace({ index: -1 });
    const trackedBefore = wsm._workspaceSignals.size;

    wsm.bindWorkspaceSignals(orphan);

    // Pre-fix the handler was connected (hasHandlers === true) but never stored,
    // so it could never be disconnected. Post-fix nothing is connected at all.
    expect(orphan.hasHandlers("window-added")).toBe(false);
    // And no untrackable entry was created either.
    expect(wsm._workspaceSignals.size).toBe(trackedBefore);
  });
});
