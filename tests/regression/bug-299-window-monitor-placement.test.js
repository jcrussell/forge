import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createMockWindow,
} from "../mocks/helpers/index.js";

/**
 * Bug #299: Windows always open on the secondary display
 *
 * Problem: When opening new windows in a multi-monitor setup, they appear on
 * the wrong monitor instead of the currently focused/active monitor.
 *
 * Fix: trackWindow() must attach the new window node under the monitor returned
 * by global.display.get_current_monitor(), not by geometric position.
 *
 * These tests exercise the real placement logic in
 * WindowManager.trackWindow() (lib/extension/window.js).
 */
describe("Bug #299: Window monitor placement", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ globals: { display: { monitorCount: 2 } } });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const wm = () => ctx.windowManager;

  it("places a new window on the active monitor (monitor 1)", () => {
    ctx.display.get_current_monitor.mockReturnValue(1);

    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
    wm().trackWindow(null, metaWindow);

    const node = wm().findNodeWindow(metaWindow);
    expect(node).not.toBeNull();

    const { monitor: mon0 } = getWorkspaceAndMonitor(ctx, 0, 0);
    const { monitor: mon1 } = getWorkspaceAndMonitor(ctx, 0, 1);

    expect(mon1.contains(node)).toBe(true);
    expect(mon0.contains(node)).toBe(false);
  });

  it("places a new window on the active monitor (monitor 0)", () => {
    ctx.display.get_current_monitor.mockReturnValue(0);

    const metaWindow = createMockWindow({ workspace: ctx.workspaces[0] });
    wm().trackWindow(null, metaWindow);

    const node = wm().findNodeWindow(metaWindow);
    expect(node).not.toBeNull();

    const { monitor: mon0 } = getWorkspaceAndMonitor(ctx, 0, 0);
    const { monitor: mon1 } = getWorkspaceAndMonitor(ctx, 0, 1);

    expect(mon0.contains(node)).toBe(true);
    expect(mon1.contains(node)).toBe(false);
  });
});
