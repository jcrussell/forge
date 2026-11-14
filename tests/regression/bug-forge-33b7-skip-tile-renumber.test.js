import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-33b7: workspace-skip-tile stores workspace indices, but adding or
 * removing a workspace renumbered only the tree nodes and workspace signals.
 * With dynamic workspaces, removing ws1 while "2" was skipped moved the
 * non-tiling mark onto the workspace that used to be ws3. The renumber now
 * shifts the setting's entries with the same mapping as the nodes.
 */
describe("forge-33b7: workspace-skip-tile follows workspaces when they are added or removed", () => {
  let ctx;

  function setup(skip) {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 3, activeWorkspaceIndex: 0 } },
      settings: { "workspace-skip-tile": skip },
    });
    ctx.windowManager._bindSignals();
  }

  const skipTile = () => ctx.settings.get_string("workspace-skip-tile");

  afterEach(() => {
    ctx.cleanup();
  });

  it("shifts an entry above the removed workspace down by one", () => {
    setup("2");
    ctx.workspaceManager.emit("workspace-removed", ctx.workspaceManager, 1);
    expect(skipTile()).toBe("1");
  });

  it("drops the entry of the removed workspace", () => {
    setup("0,1,2");
    ctx.workspaceManager.emit("workspace-removed", ctx.workspaceManager, 1);
    expect(skipTile()).toBe("0,1");
  });

  it("shifts an entry at or above an inserted workspace up by one", () => {
    setup("1");
    ctx.workspaceManager.emit("workspace-added", ctx.workspaceManager, 0);
    expect(skipTile()).toBe("2");
  });

  it("leaves the setting alone when a workspace is appended at the end", () => {
    setup("3");
    ctx.workspaceManager.emit("workspace-added", ctx.workspaceManager, 3);
    expect(skipTile()).toBe("3");
    expect(ctx.settings.set_string).not.toHaveBeenCalledWith(
      "workspace-skip-tile",
      expect.anything()
    );
  });

  it("does not write the setting when no entry changes", () => {
    setup("0");
    ctx.workspaceManager.emit("workspace-removed", ctx.workspaceManager, 1);
    expect(skipTile()).toBe("0");
    expect(ctx.settings.set_string).not.toHaveBeenCalledWith(
      "workspace-skip-tile",
      expect.anything()
    );
  });

  it("keeps an entry that is not a plain index, which never marks a workspace", () => {
    setup("01,2");
    ctx.workspaceManager.emit("workspace-removed", ctx.workspaceManager, 1);
    expect(skipTile()).toBe("01,1");
  });
});
