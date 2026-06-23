import { describe, it, expect } from "vitest";
import { accelStrvFromInput, findAccelConflicts } from "../../../lib/prefs/keyboard-accel.js";

// Tiny fakes for the Gtk accelerator API. "<Super>a" / "<Super>b" parse to
// nonzero keys (valid); anything else ("bogus") parses to key 0 (invalid).
// accelerator_name returns a canonical string for valid keys.
const KEYS = { "<Super>a": 65, "<Super>b": 66 };
const NAMES = { 65: "<Super>a", 66: "<Super>b" };

const gtk = {
  parse: (x) => {
    const key = KEYS[x] ?? 0;
    return [key !== 0, key, key !== 0 ? 8 : 0];
  },
  valid: (key) => key !== 0,
  name: (key) => NAMES[key],
};

describe("accelStrvFromInput (forge-f5sl)", () => {
  it("reports invalid for a bogus token and yields no strv (no partial save)", () => {
    expect(accelStrvFromInput("bogus", gtk)).toEqual({ valid: false, strv: null });
  });

  it("reports valid with the canonical strv for a single valid token", () => {
    expect(accelStrvFromInput("<Super>a", gtk)).toEqual({
      valid: true,
      strv: ["<Super>a"],
    });
  });

  it("reports valid with the strv for multiple valid comma-separated tokens", () => {
    expect(accelStrvFromInput("<Super>a,<Super>b", gtk)).toEqual({
      valid: true,
      strv: ["<Super>a", "<Super>b"],
    });
  });

  it("treats an empty string as a deliberate clear (valid, empty strv)", () => {
    expect(accelStrvFromInput("", gtk)).toEqual({ valid: true, strv: [] });
  });

  it("rejects a mixed valid+invalid input as a whole (no partial save)", () => {
    expect(accelStrvFromInput("<Super>a,bogus", gtk)).toEqual({ valid: false, strv: null });
  });
});

describe("findAccelConflicts (forge-cos)", () => {
  // Simulated keybinding store: key name -> assigned accelerators.
  const store = {
    "window-focus-left": ["<Super>h"],
    "window-focus-right": ["<Super>l"],
    "workspace-active-tile-toggle": ["<Super>h"], // collides with focus-left
  };
  const keys = Object.keys(store);
  const getStrv = (key) => store[key] ?? [];

  it("detects another binding using the same accelerator", () => {
    expect(
      findAccelConflicts(["<Super>h"], { selfBind: "window-focus-left", keys, getStrv })
    ).toEqual([{ accel: "<Super>h", key: "workspace-active-tile-toggle" }]);
  });

  it("excludes the key being edited from its own conflicts", () => {
    // Editing workspace-active-tile-toggle to <Super>h still conflicts with
    // window-focus-left, but must not report itself.
    expect(
      findAccelConflicts(["<Super>h"], { selfBind: "workspace-active-tile-toggle", keys, getStrv })
    ).toEqual([{ accel: "<Super>h", key: "window-focus-left" }]);
  });

  it("returns no conflicts for a unique accelerator", () => {
    expect(
      findAccelConflicts(["<Super>x"], { selfBind: "window-focus-left", keys, getStrv })
    ).toEqual([]);
  });

  it("returns no conflicts when clearing a binding (empty strv)", () => {
    expect(findAccelConflicts([], { selfBind: "window-focus-left", keys, getStrv })).toEqual([]);
  });

  it("reports one entry per offending accel/key pair across multiple accelerators", () => {
    const result = findAccelConflicts(["<Super>h", "<Super>l"], {
      selfBind: "window-move-left",
      keys,
      getStrv,
    });
    expect(result).toEqual([
      { accel: "<Super>h", key: "window-focus-left" },
      { accel: "<Super>h", key: "workspace-active-tile-toggle" },
      { accel: "<Super>l", key: "window-focus-right" },
    ]);
  });
});
