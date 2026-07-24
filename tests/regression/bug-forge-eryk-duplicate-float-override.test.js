import { describe, it, expect } from "vitest";
import { hasOverride, removeOverride } from "../../lib/prefs/floating-overrides.js";

/**
 * Bug forge-eryk (audit-2026-07b): FloatingPage.onAddHandler pushed the new rule
 * unconditionally with no duplicate check, while removeOverride is a filter on
 * structural identity and therefore drops EVERY match.
 *
 * Add "firefox" twice, then click the trash button on either row: windows.json
 * loses BOTH entries while the second row is still displayed, so the UI shows a
 * rule that no longer exists and Firefox stops floating.
 *
 * Distinct from forge-2l83/forge-xgrn, which are about `===` vs comma-list
 * matching against live window classes.
 *
 * Fix: hasOverride() lets the add path reject a structural duplicate, so
 * removeOverride's remove-all semantics (which the same-class-sibling guarantee
 * in forge-fov0 depends on) never has more than one match to remove.
 */
describe("Bug forge-eryk: duplicate float rules must not be addable", () => {
  const firefox = { wmClass: "firefox", mode: "float" };

  it("detects a structural duplicate", () => {
    expect(hasOverride([firefox], { wmClass: "firefox", mode: "float" })).toBe(true);
  });

  it("does not treat a different wmTitle as a duplicate", () => {
    const overrides = [{ wmClass: "firefox", wmTitle: "Picture-in-Picture", mode: "float" }];
    expect(hasOverride(overrides, firefox)).toBe(false);
  });

  it("does not treat a different mode as a duplicate", () => {
    expect(hasOverride([{ wmClass: "firefox", mode: "tile" }], firefox)).toBe(false);
  });

  it("does not treat a per-window (wmId) rule as a duplicate of the class rule", () => {
    expect(hasOverride([{ wmClass: "firefox", mode: "float", wmId: 42 }], firefox)).toBe(false);
  });

  it("handles a classless title-only rule without throwing", () => {
    const titleOnly = { wmTitle: "Picture-in-Picture", mode: "float" };
    expect(hasOverride([titleOnly], titleOnly)).toBe(true);
    expect(hasOverride([], titleOnly)).toBe(false);
  });

  it("returns false on an empty list", () => {
    expect(hasOverride([], firefox)).toBe(false);
  });

  it("removing one of two identical rules would delete both — so adding one must be blocked", () => {
    // This is the failure the guard exists to prevent: removeOverride is
    // remove-all by design (forge-fov0), so a list must never hold duplicates.
    const withDuplicate = [firefox, { wmClass: "firefox", mode: "float" }];
    expect(removeOverride(withDuplicate, firefox)).toHaveLength(0);

    // With the guard, the second add never lands, so the remove is well-behaved.
    const guarded = [firefox];
    const candidate = { wmClass: "firefox", mode: "float" };
    if (!hasOverride(guarded, candidate)) guarded.push(candidate);
    expect(guarded).toHaveLength(1);
    expect(removeOverride(guarded, firefox)).toHaveLength(0);
  });

  it("still allows a same-class rule that differs in wmTitle", () => {
    const overrides = [firefox];
    const pip = { wmClass: "firefox", wmTitle: "Picture-in-Picture", mode: "float" };
    if (!hasOverride(overrides, pip)) overrides.push(pip);

    expect(overrides).toHaveLength(2);
    // And removing one leaves the sibling intact (the forge-fov0 guarantee).
    expect(removeOverride(overrides, pip)).toEqual([firefox]);
  });
});
