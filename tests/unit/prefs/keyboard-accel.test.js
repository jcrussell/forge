import { describe, it, expect } from "vitest";
import { accelStrvFromInput } from "../../../lib/prefs/keyboard-accel.js";

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
