import { describe, it, expect } from "vitest";
import { resolveX, resolveY, resolveRect, findWindowWith } from "../../lib/extension/utils.js";

/**
 * Bug forge-h0w3 (audit-2026-07b): when rectRequest.x/.y is absent — or is a
 * string the switch doesn't recognise — `val` stays at the ABSOLUTE metaRect.x/.y
 * and the function then adds the work-area origin on top of it. On a secondary
 * monitor at x=1920, resolveRect({width, height}) returns 1920 + win.x; on the
 * primary it drifts down by the panel height on every call.
 *
 * Latent today — all three production paths pass explicit coordinates
 * (keybindings.js DEFAULT_FLOAT_LAYOUT -> command.js floatToggle, and
 * window.js moveCenter) — but it is a real defect in an exported helper, and it
 * contradicts resolveWidth/resolveHeight, which return the frame value unchanged
 * for exactly the same input (pinned in tests/unit/utils/utils.test.js).
 *
 * Bug forge-m46q (audit-2026-07b): findWindowWith looped wsId = 1..n over
 * Mutter's 0-based workspace indices, so workspace 0 was never scanned and the
 * last iteration passed an out-of-range index. Masked in production only because
 * get_workspace_by_index(n) returns null and get_tab_list(type, null) means "all
 * workspaces" — the accidental final sweep happened to cover workspace 0, at the
 * cost of n redundant full tab-list scans per PrefsOpen.
 */
describe("Bug forge-h0w3: an unspecified axis must mean 'leave the window where it is'", () => {
  /** Secondary monitor at x=1920; primary work area starts below a 27px panel. */
  function windowOn({ x, y, workArea }) {
    return {
      get_frame_rect: () => ({ x, y, width: 800, height: 600 }),
      get_monitor: () => 0,
      get_work_area_current_monitor: () => workArea,
    };
  }

  const secondary = { x: 1920, y: 0, width: 1920, height: 1080 };
  const primary = { x: 0, y: 27, width: 1920, height: 1053 };

  it("returns the current x when the request omits x (secondary monitor)", () => {
    const win = windowOn({ x: 2000, y: 100, workArea: secondary });
    expect(resolveX({}, win)).toBe(2000);
  });

  it("returns the current y when the request omits y (below a top panel)", () => {
    const win = windowOn({ x: 100, y: 300, workArea: primary });
    expect(resolveY({}, win)).toBe(300);
  });

  it("does not drift when called repeatedly", () => {
    const win = windowOn({ x: 100, y: 300, workArea: primary });
    expect(resolveY({}, win)).toBe(resolveY({}, win));
  });

  it("returns the current position for an unrecognised string", () => {
    const win = windowOn({ x: 2000, y: 300, workArea: secondary });
    expect(resolveX({ x: "middle" }, win)).toBe(2000);
    expect(resolveY({ y: "middle" }, win)).toBe(300);
  });

  it("matches resolveWidth/resolveHeight's no-arg contract via resolveRect", () => {
    const win = windowOn({ x: 2000, y: 300, workArea: secondary });
    expect(resolveRect({}, win)).toEqual({ x: 2000, y: 300, width: 800, height: 600 });
  });

  it("still honours explicit numbers relative to the work area", () => {
    const win = windowOn({ x: 2000, y: 300, workArea: secondary });
    expect(resolveX({ x: 40 }, win)).toBe(1960);
    expect(resolveY({ y: 40 }, win)).toBe(40);
  });

  it("still honours the named positions", () => {
    const win = windowOn({ x: 2000, y: 300, workArea: secondary });
    expect(resolveX({ x: "left", width: 800 }, win)).toBe(1920);
    expect(resolveX({ x: "right", width: 800 }, win)).toBe(1920 + 1920 - 800);
    expect(resolveX({ x: "center", width: 800 }, win)).toBe(1920 + 1920 * 0.5 - 400);
  });
});

describe("Bug forge-m46q: findWindowWith scans every workspace exactly once", () => {
  function mockDisplay({ workspaceCount, windowsByIndex }) {
    const scanned = [];
    global.display = {
      get_workspace_manager: () => ({
        get_n_workspaces: () => workspaceCount,
        get_workspace_by_index: (i) => (i >= 0 && i < workspaceCount ? { index: i } : null),
      }),
      get_tab_list: (_type, workspace) => {
        scanned.push(workspace ? workspace.index : null);
        return workspace ? windowsByIndex[workspace.index] ?? [] : [];
      },
    };
    return scanned;
  }

  it("finds a window on workspace 0", () => {
    const target = { title: "Forge Preferences" };
    mockDisplay({ workspaceCount: 3, windowsByIndex: { 0: [target] } });

    expect(findWindowWith("Forge Preferences")).toBe(target);
  });

  it("scans each valid workspace index once and never an invalid one", () => {
    const scanned = mockDisplay({ workspaceCount: 3, windowsByIndex: {} });

    findWindowWith("nothing-matches");

    expect(scanned).toEqual([0, 1, 2]);
  });

  it("still matches on a title substring", () => {
    const target = { title: "Forge Preferences" };
    mockDisplay({ workspaceCount: 2, windowsByIndex: { 1: [target] } });

    expect(findWindowWith("Preferences")).toBe(target);
  });

  it("returns undefined when nothing matches", () => {
    mockDisplay({ workspaceCount: 2, windowsByIndex: { 0: [{ title: "Terminal" }] } });

    expect(findWindowWith("Forge")).toBeUndefined();
  });
});
