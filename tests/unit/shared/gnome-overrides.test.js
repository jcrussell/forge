import { describe, it, expect } from "vitest";
import { SETTINGS_OVERRIDES, shouldApplyOverride } from "../../../lib/shared/gnome-overrides.js";

// Minimal fake exposing only get_boolean, like Forge's Gio.Settings.
const settingsWith = (values) => ({
  get_boolean: (key) => Boolean(values[key]),
});

describe("shouldApplyOverride (forge-9fo)", () => {
  const edgeTiling = SETTINGS_OVERRIDES.find((d) => d.key === "edge-tiling");
  const autoMaximize = SETTINGS_OVERRIDES.find((d) => d.key === "auto-maximize");

  it("models edge-tiling as gated by the disable-edge-tiling setting", () => {
    expect(edgeTiling.gatedBy).toBe("disable-edge-tiling");
  });

  it("applies a gated override when its Forge setting is true", () => {
    expect(shouldApplyOverride(edgeTiling, settingsWith({ "disable-edge-tiling": true }))).toBe(
      true
    );
  });

  it("skips a gated override when its Forge setting is false", () => {
    expect(shouldApplyOverride(edgeTiling, settingsWith({ "disable-edge-tiling": false }))).toBe(
      false
    );
  });

  it("always applies an ungated override regardless of settings", () => {
    expect(autoMaximize.gatedBy).toBeUndefined();
    expect(shouldApplyOverride(autoMaximize, settingsWith({}))).toBe(true);
  });

  it("leaves every override except edge-tiling ungated", () => {
    const gated = SETTINGS_OVERRIDES.filter((d) => d.gatedBy);
    expect(gated).toEqual([edgeTiling]);
  });
});
