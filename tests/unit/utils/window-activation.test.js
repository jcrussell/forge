import { describe, it, expect, vi } from "vitest";
import * as Utils from "../../../lib/extension/utils.js";
import { createMockWindow } from "../../mocks/helpers/index.js";

/**
 * forge-ext/forge#524: between "unmanaged" and the actor's destroy, the tree
 * still holds a window whose wrapper is alive but which Mutter no longer
 * manages (no compositor actor); raising, focusing or activating it fails
 * Mutter assertions.
 */
describe("Utils.safeRaise / safeFocus / safeActivate", () => {
  function windowWithSpies(actor) {
    const win = createMockWindow({ id: 1 });
    win.get_compositor_private = () => actor;
    return {
      win,
      raise: vi.spyOn(win, "raise"),
      focus: vi.spyOn(win, "focus"),
      activate: vi.spyOn(win, "activate"),
    };
  }

  it("leaves an unmanaged window (no compositor actor) alone", () => {
    const { win, raise, focus, activate } = windowWithSpies(null);

    Utils.safeRaise(win);
    Utils.safeFocus(win, 1);
    Utils.safeActivate(win, 1);

    expect(raise).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("acts on a managed window", () => {
    const { win, raise, focus, activate } = windowWithSpies({});

    Utils.safeRaise(win);
    Utils.safeFocus(win, 7);
    Utils.safeActivate(win, 7);

    expect(raise).toHaveBeenCalled();
    expect(focus).toHaveBeenCalledWith(7);
    expect(activate).toHaveBeenCalledWith(7);
  });

  it("ignores a missing window", () => {
    expect(() => {
      Utils.safeRaise(null);
      Utils.safeFocus(undefined, 1);
      Utils.safeActivate(null, 1);
    }).not.toThrow();
  });
});
