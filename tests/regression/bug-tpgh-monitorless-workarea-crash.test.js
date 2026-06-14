import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { NODE_TYPES } from "../../lib/extension/tree.js";
import { WindowType } from "../mocks/gnome/Meta.js";
import * as Utils from "../../lib/extension/utils.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

/**
 * Bug forge-tpgh: metaWindow.get_work_area_current_monitor() hits a FATAL
 * libmutter g_assert (logical_monitor != NULL) when the window has no logical
 * monitor — get_monitor() returns -1 in exactly that case (a transient dialog
 * mapped before placement, or a monitors-changed transition). The assert aborts
 * the entire gnome-shell, so the JS `if (wa)` null-checks that guarded the call
 * sites never ran: the call never returns, it kills the process.
 *
 * Repro from the user crash: a browser file-chooser dialog open while the
 * extension (re)loaded ran the processFloats -> _repositionOccludedDialog render
 * path and called get_work_area_current_monitor() on the monitor-less dialog.
 *
 * Fix: Utils.getWorkAreaSafe() gates on get_monitor() >= 0 before calling, so a
 * monitor-less window short-circuits to null and the C call is never reached.
 */
describe("Bug forge-tpgh: monitor-less window does not abort via work-area lookup", () => {
  // Mirror mutter's fatal assert: calling get_work_area on a monitor-less
  // window aborts. The test treats that as a thrown error it must never reach.
  const failIfWorkAreaCalled = (win) =>
    vi.spyOn(win, "get_work_area_current_monitor").mockImplementation(() => {
      throw new Error("libmutter abort: meta_window_get_work_area_for_logical_monitor");
    });

  describe("getWorkAreaSafe helper", () => {
    it("returns null and never calls the C function when get_monitor() is -1", () => {
      const win = createMockWindow({ monitor: -1 });
      failIfWorkAreaCalled(win);
      expect(Utils.getWorkAreaSafe(win)).toBeNull();
      expect(win.get_work_area_current_monitor).not.toHaveBeenCalled();
    });

    it("returns the work area when the window has a valid monitor", () => {
      const win = createMockWindow({ monitor: 0 });
      const wa = Utils.getWorkAreaSafe(win);
      expect(wa).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
    });
  });

  describe("resolve* fall back to the frame rect on a monitor-less window", () => {
    it("resolveX/Y return the current frame coords without calling the C function", () => {
      const win = createMockWindow({
        monitor: -1,
        rect: { x: 700, y: 350, width: 400, height: 300 },
      });
      failIfWorkAreaCalled(win);
      expect(Utils.resolveX({ x: "center" }, win)).toBe(700);
      expect(Utils.resolveY({ y: "center" }, win)).toBe(350);
      expect(win.get_work_area_current_monitor).not.toHaveBeenCalled();
    });
  });

  describe("processFloats render path", () => {
    let ctx;
    let parent;
    let neighbor;

    beforeEach(() => {
      ctx = createWindowManagerFixture();
      const { monitor } = getWorkspaceAndMonitor(ctx);
      // Two tiled windows split the work area: parent left, neighbor right — so a
      // dialog overlapping the neighbor is "occluded" and reaches the work-area
      // lookup (the line that aborted the shell).
      parent = createMockWindow({
        id: 7001,
        title: "Editor",
        rect: { x: 0, y: 0, width: 960, height: 1080 },
      });
      neighbor = createMockWindow({
        id: 7002,
        title: "Browser",
        rect: { x: 960, y: 0, width: 960, height: 1080 },
      });
      const nodeParent = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, parent);
      const nodeNeighbor = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, neighbor);
      nodeParent.mode = WINDOW_MODES.TILE;
      nodeNeighbor.mode = WINDOW_MODES.TILE;
    });

    afterEach(() => {
      ctx.cleanup();
      vi.restoreAllMocks();
    });

    it("does not abort when an occluded transient dialog has no monitor", () => {
      // File-chooser dialog from `parent` placed over the `neighbor` (occluded),
      // but mapped before Mutter gave it a logical monitor (get_monitor() === -1).
      const dialog = createMockWindow({
        id: 7003,
        title: "Open File",
        window_type: WindowType.DIALOG,
        transient_for: parent,
        monitor: -1,
        rect: { x: 1000, y: 400, width: 400, height: 300 },
      });
      failIfWorkAreaCalled(dialog);
      ctx.tree.createNode(
        ctx.tree.getNodeByType(NODE_TYPES.MONITOR)[0].nodeValue,
        NODE_TYPES.WINDOW,
        dialog
      );

      // Pre-condition: it overlaps the neighbor, so the occlusion path runs.
      expect(Utils.rectsOverlap(dialog.get_frame_rect(), neighbor.get_frame_rect())).toBe(true);

      expect(() => ctx.windowManager.processFloats()).not.toThrow();
      // The guard short-circuited before the C call that aborts the shell.
      expect(dialog.get_work_area_current_monitor).not.toHaveBeenCalled();
    });

    it("does not throw in processNode when a window has no monitor and no rect", () => {
      // When ancestor layout has not assigned a rect, processNode falls back to
      // the work area. A monitor-less window (get_monitor() === -1) can't resolve
      // one; processGap dereferences node.rect, so the node must be skipped until
      // a later render — once Mutter assigns a monitor — rather than crash.
      const orphan = createMockWindow({
        id: 7004,
        title: "Orphan",
        monitor: -1,
        rect: { x: 0, y: 0, width: 960, height: 1080 },
      });
      failIfWorkAreaCalled(orphan);
      const node = ctx.tree.createNode(
        getWorkspaceAndMonitor(ctx).monitor.nodeValue,
        NODE_TYPES.WINDOW,
        orphan
      );
      node.mode = WINDOW_MODES.TILE;
      node.rect = null;

      // Process the window node directly so no ancestor split assigns its rect.
      expect(() => ctx.tree.processNode(node)).not.toThrow();
      expect(orphan.get_work_area_current_monitor).not.toHaveBeenCalled();
      // No renderRect was fabricated from a bad monitor; it stays unset.
      expect(node.renderRect).toBeFalsy();
    });
  });
});
