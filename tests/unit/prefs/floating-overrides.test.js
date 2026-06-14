import { describe, it, expect } from "vitest";
import { removeOverride, sortFloatOverrides } from "../../../lib/prefs/floating-overrides.js";

describe("removeOverride (forge-fov0)", () => {
  // Two same-class firefox float rules differing only by wmTitle, a same-class
  // firefox tile rule, and an unrelated class. The buggy old logic filtered by
  // wmClass and would wipe all three firefox rows when removing one.
  const buildOverrides = () => {
    const firefoxFloatA = { wmClass: "firefox", wmTitle: "Picture-in-Picture", mode: "float" };
    const firefoxFloatB = { wmClass: "firefox", wmTitle: "Library", mode: "float" };
    const firefoxTile = { wmClass: "firefox", mode: "tile" };
    const unrelated = { wmClass: "gnome-calculator", mode: "float" };
    return { firefoxFloatA, firefoxFloatB, firefoxTile, unrelated };
  };

  it("removes only the targeted override and keeps same-class siblings + tile rule + unrelated", () => {
    const { firefoxFloatA, firefoxFloatB, firefoxTile, unrelated } = buildOverrides();
    const overrides = [firefoxFloatA, firefoxFloatB, firefoxTile, unrelated];

    const result = removeOverride(overrides, firefoxFloatA);

    expect(result).not.toContain(firefoxFloatA);
    expect(result).toContain(firefoxFloatB);
    expect(result).toContain(firefoxTile);
    expect(result).toContain(unrelated);
    expect(result).toHaveLength(3);
  });

  it("returns a new array, leaving the original untouched", () => {
    const { firefoxFloatA, firefoxFloatB, firefoxTile, unrelated } = buildOverrides();
    const overrides = [firefoxFloatA, firefoxFloatB, firefoxTile, unrelated];

    const result = removeOverride(overrides, firefoxFloatA);

    expect(result).not.toBe(overrides);
    expect(overrides).toHaveLength(4);
  });

  it("contrast: the old wmClass-based filter would have wiped every firefox rule", () => {
    const { firefoxFloatA, firefoxFloatB, firefoxTile, unrelated } = buildOverrides();
    const overrides = [firefoxFloatA, firefoxFloatB, firefoxTile, unrelated];

    // Simulate the buggy behavior to document why structural matching is required.
    const buggy = overrides.filter((o) => firefoxFloatA.wmClass != o.wmClass);
    expect(buggy).toHaveLength(1); // only the unrelated rule survives — the bug

    // The real helper preserves the siblings.
    expect(removeOverride(overrides, firefoxFloatA)).toHaveLength(3);
  });

  it("matches structurally across re-parsed instances (windowProps re-reads JSON)", () => {
    // The real bug: the override captured when the row was built and the one read
    // back from configMgr.windowProps at removal time are DIFFERENT object
    // instances (the getter re-parses windows.json each call). A reference match
    // would delete nothing — the row vanishes from the UI but the rule persists.
    const { firefoxFloatA, firefoxFloatB, firefoxTile, unrelated } = buildOverrides();
    const onDisk = [firefoxFloatA, firefoxFloatB, firefoxTile, unrelated];

    // Same fields, fresh instance — simulating a re-parse of windows.json.
    const reparsedTarget = { wmClass: "firefox", wmTitle: "Picture-in-Picture", mode: "float" };
    expect(reparsedTarget).not.toBe(firefoxFloatA);

    const result = removeOverride(onDisk, reparsedTarget);

    expect(result).toHaveLength(3);
    expect(result).not.toContain(firefoxFloatA); // the PiP rule is gone
    expect(result).toContain(firefoxFloatB); // the Library sibling survives
    expect(result).toContain(firefoxTile); // the tile rule survives
  });

  it("distinguishes a wmTitle-less rule from a titled same-class sibling", () => {
    const bare = { wmClass: "firefox", mode: "float" };
    const titled = { wmClass: "firefox", wmTitle: "Library", mode: "float" };
    const result = removeOverride([bare, titled], { wmClass: "firefox", mode: "float" });
    expect(result).toEqual([titled]);
  });
});

describe("sortFloatOverrides (forge-n29i)", () => {
  it("sorts a title-only float rule (no wmClass) without throwing and filters out non-float", () => {
    const titleOnly = { wmTitle: "Picture-in-Picture", mode: "float" }; // no wmClass
    const gedit = { wmClass: "gedit", mode: "float" };
    const firefox = { wmClass: "firefox", mode: "float" };
    const calcTile = { wmClass: "gnome-calculator", mode: "tile" }; // excluded

    let result;
    expect(() => {
      result = sortFloatOverrides([gedit, titleOnly, firefox, calcTile]);
    }).not.toThrow();

    // Only float rules survive. Absolute position of the classless rule is not
    // asserted (its capital-P key vs lowercase keys orders differently across
    // locales); we assert membership, exclusion of the tile rule, and the stable
    // class-full ordering below.
    expect(result).toHaveLength(3);
    expect(result).toContain(titleOnly);
    expect(result).toContain(firefox);
    expect(result).toContain(gedit);
    expect(result).not.toContain(calcTile);

    // class-full rules order alphabetically by wmClass
    expect(result.indexOf(firefox)).toBeLessThan(result.indexOf(gedit));
  });

  it("returns a new array and does not mutate the input order", () => {
    const a = { wmClass: "b-app", mode: "float" };
    const b = { wmClass: "a-app", mode: "float" };
    const input = [a, b];
    const result = sortFloatOverrides(input);
    expect(result).not.toBe(input);
    expect(result[0]).toBe(b); // sorted
    expect(input).toEqual([a, b]); // original untouched
  });

  it("handles empty input", () => {
    expect(sortFloatOverrides([])).toEqual([]);
  });

  it("sorts multiple classless rules by wmTitle without throwing", () => {
    const z = { wmTitle: "Zoom", mode: "float" };
    const a = { wmTitle: "Audio", mode: "float" };
    let r;
    expect(() => {
      r = sortFloatOverrides([z, a]);
    }).not.toThrow();
    expect(r.indexOf(a)).toBeLessThan(r.indexOf(z));
  });
});
