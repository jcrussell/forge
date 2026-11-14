import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * forge-l8k4: closing a window removed its per-window float rule but left its
 * per-window tile rule in windows.json until the next startup prune. A close
 * removes both in one write, and writes nothing when the window has none.
 */
describe("forge-l8k4: closing a window removes its per-window rules", () => {
  let ctx;
  let disk;
  let writes;

  // Each read returns a fresh copy and each write replaces the store, like the file.
  function installDisk(overrides) {
    disk = structuredClone(overrides);
    writes = 0;
    ctx.windowManager.ext.configMgr = {
      get windowProps() {
        return { overrides: structuredClone(disk) };
      },
      set windowProps(props) {
        writes++;
        disk = structuredClone(props.overrides);
      },
    };
    ctx.windowManager.windowProps = ctx.windowManager.ext.configMgr.windowProps;
  }

  function closeWindow(id) {
    const win = createMockWindow({ wm_class: "gedit", id, title: "Notes", allows_resize: true });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    vi.spyOn(ctx.tree, "findNodeByActor").mockReturnValue(node);
    ctx.windowManager.windowDestroy(win.get_compositor_private());
  }

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("removes the closed window's per-window tile and float rules in one write", () => {
    installDisk([
      { wmClass: "gedit", wmId: 1, mode: "tile" },
      { wmClass: "gedit", wmId: 1, mode: "float" },
      { wmClass: "gedit", mode: "float" },
      { wmClass: "gedit", wmId: 2, mode: "tile" },
    ]);

    closeWindow(1);

    expect(disk).toEqual([
      { wmClass: "gedit", mode: "float" },
      { wmClass: "gedit", wmId: 2, mode: "tile" },
    ]);
    expect(writes).toBe(1);
  });

  it("writes nothing when the closed window has no per-window rule", () => {
    installDisk([{ wmClass: "gedit", mode: "tile" }]);

    closeWindow(1);

    expect(disk).toEqual([{ wmClass: "gedit", mode: "tile" }]);
    expect(writes).toBe(0);
  });
});
