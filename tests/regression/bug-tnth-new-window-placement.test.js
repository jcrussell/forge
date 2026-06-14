import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createMockWindow,
} from "../mocks/helpers/index.js";

/**
 * forge-tnth (gh #299/#427/#388/#353): new windows open on the "wrong" monitor.
 *
 * Phase-0 finding (this test): trackWindow() homes a new window to the POINTER
 * monitor (global.display.get_current_monitor()), but updateMetaWorkspaceMonitor()
 * runs next and re-homes it to the window's ACTUAL monitor (get_monitor()). So
 * the END STATE is already "window-actual"; the initial triage ("homes to
 * pointer") only describes the transient track-time placement.
 *
 * Fix (maintainer choice: make it configurable): the new gsetting
 * 'new-window-placement' controls the INITIAL homing. 'pointer' (default)
 * preserves the current track-time behavior; 'window-actual' places the window
 * on its own monitor from the start (matching the eventual re-home and avoiding
 * a redundant move for apps that restore their geometry).
 *
 * These tests drive the real WindowManager.trackWindow() /
 * updateMetaWorkspaceMonitor() on a 2-monitor fixture.
 */
describe("forge-tnth: configurable new-window monitor placement", () => {
  let ctx;

  function setup(placement) {
    ctx = createWindowManagerFixture({
      globals: { display: { monitorCount: 2 } },
      settings: placement ? { "new-window-placement": placement } : {},
    });
    // Pointer is on monitor 0 for every case.
    ctx.display.get_current_monitor.mockReturnValue(0);
  }

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;
  const monitorOf = (node) => {
    const { monitor: mon0 } = getWorkspaceAndMonitor(ctx, 0, 0);
    const { monitor: mon1 } = getWorkspaceAndMonitor(ctx, 0, 1);
    if (mon1.contains(node)) return 1;
    if (mon0.contains(node)) return 0;
    return -1;
  };

  it("default 'pointer': track-time homes to the pointer monitor", () => {
    setup(); // default 'pointer'
    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0], monitor: 1 });

    wm().trackWindow(null, metaWindow);

    // Window's actual monitor is 1, but the pointer is on 0: placed on 0.
    expect(monitorOf(wm().findNodeWindow(metaWindow))).toBe(0);
  });

  it("'window-actual': track-time homes to the window's own monitor", () => {
    setup("window-actual");
    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0], monitor: 1 });

    wm().trackWindow(null, metaWindow);

    // Placed directly on monitor 1, ignoring the pointer on 0.
    expect(monitorOf(wm().findNodeWindow(metaWindow))).toBe(1);
  });

  it("'window-actual' with the window on the pointer monitor stays put (no off-by-one)", () => {
    setup("window-actual");
    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0], monitor: 0 });

    wm().trackWindow(null, metaWindow);

    expect(monitorOf(wm().findNodeWindow(metaWindow))).toBe(0);
  });

  it("'window-actual' with get_monitor() === -1 (Wayland) falls back to the pointer monitor, no reload", () => {
    // On Wayland a window can report monitor -1 before it's positioned. Building
    // an id from -1 (mo-1ws0) misses findNode and used to fire a spurious full
    // reloadTree('no-meta-monws') that abandoned placement. The guard falls back
    // to the pointer monitor instead. (forge-4cv/4dm/91s/vmx)
    setup("window-actual");
    const reloadSpy = vi.spyOn(wm(), "reloadTree");
    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0], monitor: -1 });

    wm().trackWindow(null, metaWindow);

    // Placed on the pointer monitor (0), and no spurious reload — the reload is
    // the actual defect, not the monitor index.
    expect(monitorOf(wm().findNodeWindow(metaWindow))).toBe(0);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("end-state is window-actual regardless of the setting (re-home wins) — documents MF-1", () => {
    // Default 'pointer': track-time on 0, then updateMetaWorkspaceMonitor re-homes
    // to the window's actual monitor (1). This is why a 'pointer'-only change at
    // trackWindow can't, by itself, fix a "wrong monitor" report.
    setup(); // default 'pointer'
    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0], monitor: 1 });

    wm().trackWindow(null, metaWindow);
    expect(monitorOf(wm().findNodeWindow(metaWindow))).toBe(0); // transient

    wm().updateMetaWorkspaceMonitor("window-entered-monitor", 1, metaWindow);
    expect(monitorOf(wm().findNodeWindow(metaWindow))).toBe(1); // settled end-state
  });
});
