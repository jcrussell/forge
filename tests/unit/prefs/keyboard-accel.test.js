import { describe, it, expect, vi } from "vitest";
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

// Mirror keyboard.js's to() seam: invalid => return false + no set_strv,
// valid => return true + set_strv with the names, clear => return true + [].
function makeTo(settings) {
  return (bind, value) => {
    const { valid, strv } = accelStrvFromInput(value, gtk);
    if (!valid) return false;
    settings.set_strv(bind, strv);
    return true;
  };
}

describe("EntryRow.to() contract for accelerators (forge-f5sl)", () => {
  const makeSettings = () => ({ set_strv: vi.fn() });

  it("returns false and does NOT write settings on invalid input", () => {
    const settings = makeSettings();
    const to = makeTo(settings);
    expect(to("window-toggle-float", "bogus")).toBe(false);
    expect(settings.set_strv).not.toHaveBeenCalled();
  });

  it("returns true and writes the canonical strv on valid input", () => {
    const settings = makeSettings();
    const to = makeTo(settings);
    expect(to("window-toggle-float", "<Super>a")).toBe(true);
    expect(settings.set_strv).toHaveBeenCalledWith("window-toggle-float", ["<Super>a"]);
  });

  it("returns true and clears the binding on empty input", () => {
    const settings = makeSettings();
    const to = makeTo(settings);
    expect(to("window-toggle-float", "")).toBe(true);
    expect(settings.set_strv).toHaveBeenCalledWith("window-toggle-float", []);
  });

  it("returns false and does NOT write on mixed valid+invalid input", () => {
    const settings = makeSettings();
    const to = makeTo(settings);
    expect(to("window-toggle-float", "<Super>a,bogus")).toBe(false);
    expect(settings.set_strv).not.toHaveBeenCalled();
  });
});
