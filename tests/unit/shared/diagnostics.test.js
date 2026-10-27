import { describe, it, expect } from "vitest";
import {
  MAX_ENTRIES,
  RingLog,
  buildReport,
  describeAction,
  findLayoutProblems,
  formatEntry,
  issueUrl,
  noChangeReason,
  windowLabel,
} from "../../../lib/shared/diagnostics.js";

describe("diagnostic log helpers", () => {
  it("keeps only the last entries", () => {
    const ring = new RingLog(3);
    [1, 2, 3, 4, 5].forEach((n) => ring.push(n));
    expect(ring.entries).toEqual([3, 4, 5]);
    expect(new RingLog().max).toBe(MAX_ENTRIES);
  });

  it("names commands the way a report reads them", () => {
    expect(describeAction({ name: "Focus", direction: "Left" })).toBe("Focus Left");
    expect(describeAction({ name: "Split", orientation: "vertical" })).toBe("Split vertical");
    expect(describeAction({ name: "GapSize", amount: 1 })).toBe("GapSize +1");
    expect(describeAction({ name: "WindowResizeRight", amount: -25 })).toBe(
      "WindowResizeRight -25"
    );
    expect(describeAction({ name: "SnapLayoutMove", direction: "Right", amount: 1 / 3 })).toBe(
      "SnapLayoutMove Right"
    );
  });

  it("names a window by its app and a short id, never its title", () => {
    expect(windowLabel("org.gnome.Nautilus", 12345)).toBe("org.gnome.Nautilus#345");
    expect(windowLabel(null, 7)).toBe("unknown#7");
    expect(windowLabel("My App", 1)).toBe("My_App#1");
  });

  it("formats a line with time, source, action, window and outcome", () => {
    const line = formatEntry({
      time: new Date(2026, 9, 27, 9, 5, 3),
      source: "key",
      action: "Focus Left",
      target: "firefox#12 (tiled in HSPLIT)",
      outcome: "ok",
    });
    expect(line).toMatch(/^09:05:03 key +Focus Left +firefox#12 \(tiled in HSPLIT\) +ok$/);
    expect(formatEntry({ time: new Date(), source: "mouse", action: "drag title" })).toMatch(/…$/);
  });

  it("explains a command that changed nothing", () => {
    expect(noChangeReason({ tilingEnabled: false, state: "tiled in HSPLIT" })).toMatch(
      /tiling is off/
    );
    expect(noChangeReason({ tilingEnabled: true, state: "floating: dialog" })).toMatch(
      /floating: dialog; tiling shortcuts act on tiled windows/
    );
    expect(noChangeReason({ tilingEnabled: true, state: "maximized" })).toMatch(/restore it/);
    expect(noChangeReason({ tilingEnabled: true, state: "no window focused" })).toMatch(
      /no window/
    );
    expect(noChangeReason({ tilingEnabled: true, state: "tiled in HSPLIT" })).toBeNull();
  });

  describe("layout problems", () => {
    const area = { 0: { x: 0, y: 32, width: 1920, height: 1048 } };
    const win = (label, x, y, width, height, group = null) => ({
      label,
      x,
      y,
      width,
      height,
      monitor: 0,
      group,
    });

    it("finds windows that overlap or leave the screen", () => {
      const problems = findLayoutProblems(
        [
          win("a#1", 0, 32, 1000, 1048),
          win("b#2", 900, 32, 1020, 1048),
          win("c#3", 1500, 32, 600, 500),
        ],
        area
      );
      expect(problems).toContain("a#1 and b#2 overlap by 100x1048px");
      expect(problems).toContain("c#3 is 180px off its screen");
    });

    it("accepts a tiled layout, gaps and tab groups", () => {
      const group = {};
      expect(
        findLayoutProblems(
          [
            win("a#1", 4, 36, 952, 1040),
            win("b#2", 964, 36, 952, 1040, group),
            win("c#3", 964, 36, 952, 1040, group),
          ],
          area
        )
      ).toEqual([]);
    });
  });

  it("builds a report with every section", () => {
    const report = buildReport({
      forgeVersion: "v1",
      session: "wayland",
      state: "monitor 0: HSPLIT[a#1]",
      settings: ["auto-split-enabled = true"],
      log: "09:00:00 key Focus Left",
    });
    expect(report).toMatch(/^Forge v1 · session wayland/);
    expect(report).toContain("## Screen and windows");
    expect(report).toContain("auto-split-enabled = true");
    expect(report).toContain("09:00:00 key Focus Left");
    expect(
      buildReport({ forgeVersion: "v1", session: "x", state: "", settings: [], log: "" })
    ).toContain("(none)");
  });

  it("puts the report in the issue link only while the link stays short", () => {
    const short = issueUrl("https://example.com/new", "t", "small report");
    expect(decodeURIComponent(short)).toContain("small report");
    const long = issueUrl("https://example.com/new", "t", "x".repeat(20000));
    expect(long.length).toBeLessThan(2000);
    expect(decodeURIComponent(long)).toContain("copied to the clipboard");
  });
});
