import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CommandHandler } from "../../lib/extension/command.js";
import { installGnomeGlobals } from "../mocks/helpers/index.js";

/**
 * Bug forge-myzp (audit-2026-07 / C14): WorkspaceActiveTileToggle's removal path splits
 * the "workspace-skip-tile" string on "," WITHOUT trimming, but membership
 * (_isWorkspaceSkipped) trims entries. On a spaced value like "0, 1, 2", indexOf("1")
 * returns -1 and splice(-1, 1) deletes the LAST entry (" 2") instead of the active
 * workspace — ws2 wrongly loses its skip flag while ws1 stays listed.
 *
 * Fix: trim each entry when splitting so indexOf finds the active workspace.
 */
describe("Bug forge-myzp: WorkspaceActiveTileToggle handles spaced skip lists", () => {
  let commandHandler;
  let mockWm;
  let ctx;
  let written;

  beforeEach(() => {
    ctx = installGnomeGlobals();
    ctx.workspaceManager.get_active_workspace_index = vi.fn(() => 1);
    global.workspace_manager = ctx.workspaceManager;

    written = null;
    mockWm = {
      focusMetaWindow: null,
      findNodeWindow: () => null,
      ext: {
        settings: {
          get_string: () => "0, 1, 2",
          set_string: (_key, val) => {
            written = val;
          },
        },
      },
      // ws1 is currently skipped -> we're on the removal path.
      _isWorkspaceSkipped: () => true,
      unfloatWorkspace: vi.fn(),
      floatWorkspace: vi.fn(),
      renderTree: vi.fn(),
    };
    commandHandler = new CommandHandler(mockWm);
  });

  afterEach(() => ctx.cleanup());

  it("removes the active workspace (1), not the last entry", () => {
    commandHandler.execute({ name: "WorkspaceActiveTileToggle" });
    const remaining = written.split(",").map((s) => s.trim());
    expect(remaining).not.toContain("1");
    expect(remaining).toContain("0");
    expect(remaining).toContain("2");
    expect(mockWm.unfloatWorkspace).toHaveBeenCalledWith(1);
  });
});
