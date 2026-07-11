import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockWindow, createWindowManagerFixture } from "../mocks/helpers/index.js";

/**
 * forge-16ms (P1 regression): windows never tiled on non-primary monitors under
 * the GNOME default workspaces-only-on-primary=true.
 *
 * The forge-yyum float-by-role rule tested metaWindow.is_on_all_workspaces() —
 * the EFFECTIVE sticky state. But under workspaces-only-on-primary=true Mutter
 * makes every window on a non-primary monitor implicitly sticky with NO user pin,
 * so is_on_all_workspaces() was true and processFloats float-ejected every new or
 * moved window on a secondary monitor.
 *
 * Fix: test the user PIN via Compat.isAlwaysOnAllWorkspaces
 * (is_always_on_all_workspaces), which is false for the implicit case and true
 * only for a real "Always on Visible Workspace" pin.
 */
describe("forge-16ms: implicit non-primary stickiness still tiles", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => ctx.cleanup());

  const wm = () => ctx.windowManager;

  it("does not float-eject a window that is only implicitly sticky", () => {
    const implicit = createMockWindow({ wm_class: "App", title: "Doc" });
    // Mutter's implicit non-primary-monitor stickiness: effective sticky, no pin.
    implicit.stickImplicit();
    expect(implicit.is_on_all_workspaces()).toBe(true);
    expect(implicit.is_always_on_all_workspaces()).toBe(false);

    // Before forge-16ms this was true (floated) — nothing tiled on secondary monitors.
    expect(wm().isFloatingExempt(implicit)).toBe(false);
  });

  it("still floats a window the user actually pinned Always-on-Visible-Workspace", () => {
    const pinned = createMockWindow({ wm_class: "App", title: "Doc" });
    pinned.stick(); // user pin: sets both the requested flag and effective state
    expect(pinned.is_always_on_all_workspaces()).toBe(true);
    expect(wm().isFloatingExempt(pinned)).toBe(true);
  });
});
