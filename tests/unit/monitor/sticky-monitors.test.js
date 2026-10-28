import { describe, it, expect } from "vitest";
import { planStickyMonitorRehome } from "../../../lib/extension/sticky-monitors.js";

/**
 * Under workspaces-only-on-primary, Mutter makes every window on a non-primary
 * monitor implicitly sticky and reports the ACTIVE workspace for it, without
 * emitting workspace-changed when the active workspace switches. The tree keys
 * monitor nodes by workspace (mo{m}ws{n}), so those windows stay under the
 * workspace that was active when they were homed. planStickyMonitorRehome decides
 * which non-primary monitor sub-trees must follow the active workspace.
 */
describe("planStickyMonitorRehome", () => {
  const plan = (overrides) =>
    planStickyMonitorRehome({
      activeWs: 1,
      primaryMonitor: 1,
      onlyOnPrimary: true,
      homes: [],
      ...overrides,
    });

  it("moves a non-primary monitor's sub-tree to the newly active workspace", () => {
    const moves = plan({ homes: [{ monitor: 0, ws: 4, windows: 2 }] });

    expect(moves).toEqual([{ monitor: 0, fromWs: 4, toWs: 1, transplant: true }]);
  });

  it("does nothing when workspaces span all monitors", () => {
    const moves = plan({ onlyOnPrimary: false, homes: [{ monitor: 0, ws: 4, windows: 2 }] });

    expect(moves).toEqual([]);
  });

  it("never moves the primary monitor's windows", () => {
    const moves = plan({ homes: [{ monitor: 1, ws: 4, windows: 3 }] });

    expect(moves).toEqual([]);
  });

  it("leaves a sub-tree that already lives on the active workspace", () => {
    const moves = plan({ homes: [{ monitor: 0, ws: 1, windows: 2 }] });

    expect(moves).toEqual([]);
  });

  it("ignores monitor nodes without windows", () => {
    const moves = plan({ homes: [{ monitor: 0, ws: 4, windows: 0 }] });

    expect(moves).toEqual([]);
  });

  it("does nothing without a valid active workspace", () => {
    const moves = plan({ activeWs: -1, homes: [{ monitor: 0, ws: 4, windows: 2 }] });

    expect(moves).toEqual([]);
  });

  it("merges instead of transplanting when the target already holds windows", () => {
    const moves = plan({
      homes: [
        { monitor: 0, ws: 1, windows: 1 },
        { monitor: 0, ws: 4, windows: 2 },
      ],
    });

    expect(moves).toEqual([{ monitor: 0, fromWs: 4, toWs: 1, transplant: false }]);
  });

  it("transplants the largest stray sub-tree and merges the rest", () => {
    const moves = plan({
      homes: [
        { monitor: 0, ws: 2, windows: 1 },
        { monitor: 0, ws: 4, windows: 3 },
      ],
    });

    expect(moves).toEqual([
      { monitor: 0, fromWs: 4, toWs: 1, transplant: true },
      { monitor: 0, fromWs: 2, toWs: 1, transplant: false },
    ]);
  });

  it("breaks a size tie by the lower workspace index", () => {
    const moves = plan({
      homes: [
        { monitor: 0, ws: 5, windows: 2 },
        { monitor: 0, ws: 3, windows: 2 },
      ],
    });

    expect(moves.map((m) => [m.fromWs, m.transplant])).toEqual([
      [3, true],
      [5, false],
    ]);
  });

  it("plans each non-primary monitor independently", () => {
    const moves = plan({
      primaryMonitor: 0,
      homes: [
        { monitor: 1, ws: 4, windows: 1 },
        { monitor: 2, ws: 1, windows: 1 },
        { monitor: 2, ws: 3, windows: 2 },
      ],
    });

    expect(moves).toEqual([
      { monitor: 1, fromWs: 4, toWs: 1, transplant: true },
      { monitor: 2, fromWs: 3, toWs: 1, transplant: false },
    ]);
  });
});
