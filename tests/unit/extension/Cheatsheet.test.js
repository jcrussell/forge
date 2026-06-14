import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Cheatsheet } from "../../../lib/extension/cheatsheet.js";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { installGnomeGlobals } from "../../mocks/helpers/index.js";

/**
 * Cheatsheet behavioral tests.
 *
 * Covers two lifecycle bugs:
 *  - forge-v3y3: show() must not re-parent an overlay that is still a child of
 *    uiGroup (fast toggle within the 100ms hide ease) — Clutter double-parent.
 *  - forge-k5m6: an open overlay must re-center on monitors-changed, and the
 *    signal must be disconnected on hide()/destroy().
 */
describe("Cheatsheet", () => {
  let ctx;
  let uiGroup;
  let cheatsheet;
  let mockExt;

  beforeEach(() => {
    ctx = installGnomeGlobals({ display: { monitorCount: 1 } });

    // uiGroup that tracks parenting like Clutter: add_child sets child._parent,
    // remove_child clears it. add_child throws if the actor already has a parent
    // (mirrors clutter_actor_add_child's g_return_if_fail).
    uiGroup = {
      children: [],
      add_child: vi.fn(function (child) {
        if (child._parent != null) {
          throw new Error("The actor already has a parent");
        }
        child._parent = this;
        this.children.push(child);
      }),
      remove_child: vi.fn(function (child) {
        const i = this.children.indexOf(child);
        if (i !== -1) this.children.splice(i, 1);
        if (child._parent === this) child._parent = null;
      }),
    };
    Main.layoutManager = { uiGroup };

    mockExt = {
      kbdSettings: {
        list_keys: vi.fn(() => []),
        get_strv: vi.fn(() => []),
      },
    };

    cheatsheet = new Cheatsheet(mockExt);
  });

  afterEach(() => {
    delete Main.layoutManager;
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  describe("fast double-toggle (forge-v3y3)", () => {
    it("does not re-parent an overlay still parented during the hide ease", () => {
      cheatsheet.show();
      const overlay = cheatsheet._overlay;
      expect(overlay._parent).toBe(uiGroup);

      // Reproduce the window where hide() has set _visible=false but the 100ms
      // ease onComplete has NOT run, so the overlay is still parented.
      // Override ease to defer onComplete instead of running it synchronously.
      overlay.ease = vi.fn();
      cheatsheet.hide();
      expect(cheatsheet.visible).toBe(false);
      expect(overlay._parent).toBe(uiGroup); // still parented

      uiGroup.add_child.mockClear();

      // Toggling back on must not re-parent the already-parented overlay (a
      // fresh backdrop may be re-added, but never the overlay).
      expect(() => cheatsheet.show()).not.toThrow();
      expect(uiGroup.add_child).not.toHaveBeenCalledWith(overlay);
    });

    it("adds the overlay exactly once on a normal show", () => {
      cheatsheet.show();
      const overlayAdds = uiGroup.add_child.mock.calls.filter((c) => c[0] === cheatsheet._overlay);
      expect(overlayAdds).toHaveLength(1);
      expect(cheatsheet._overlay._parent).toBe(uiGroup);
    });
  });

  describe("dismiss affordances (forge-0rb6)", () => {
    it("closes on Escape", () => {
      cheatsheet.show();
      const overlay = cheatsheet._overlay;
      expect(cheatsheet.visible).toBe(true);

      overlay.emit("key-press-event", overlay, { get_key_symbol: () => Clutter.KEY_Escape });

      expect(cheatsheet.visible).toBe(false);
    });

    it("ignores non-Escape keys", () => {
      cheatsheet.show();
      const overlay = cheatsheet._overlay;

      overlay.emit("key-press-event", overlay, { get_key_symbol: () => 0x61 /* 'a' */ });

      expect(cheatsheet.visible).toBe(true);
    });

    it("closes on a click outside the panel (backdrop)", () => {
      cheatsheet.show();
      const backdrop = cheatsheet._backdrop;
      expect(backdrop).toBeTruthy();

      backdrop.emit("button-press-event", {});

      expect(cheatsheet.visible).toBe(false);
    });

    it("closes when the close button is clicked", () => {
      cheatsheet.show();
      // headerRow is the first child; its close button is the last child.
      const headerRow = cheatsheet._overlay.get_children()[0];
      const closeButton = headerRow.get_children()[headerRow.get_children().length - 1];

      closeButton.emit("clicked");

      expect(cheatsheet.visible).toBe(false);
    });

    it("removes the backdrop on hide", () => {
      cheatsheet.show();
      expect(cheatsheet._backdrop).toBeTruthy();
      cheatsheet.hide();
      expect(cheatsheet._backdrop).toBeNull();
    });
  });

  describe("re-center on monitors-changed (forge-k5m6)", () => {
    it("connects monitors-changed on show and re-centers when geometry changes", () => {
      cheatsheet.show();
      expect(global.display.hasHandlers("monitors-changed")).toBe(true);

      const overlay = cheatsheet._overlay;
      // Give the overlay a known size so centering math is deterministic.
      overlay.width = 400;
      overlay.height = 300;
      const beforeX = overlay.x;

      // Simulate a resolution/monitor change to a different geometry.
      global.display.get_monitor_geometry.mockReturnValue({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      });
      const setPosSpy = vi.spyOn(overlay, "set_position");
      global.display.emit("monitors-changed");

      expect(setPosSpy).toHaveBeenCalled();
      // New center: (800-400)/2 = 200, (600-300)/2 = 150.
      expect(overlay.x).toBe(200);
      expect(overlay.y).toBe(150);
      expect(overlay.x).not.toBe(beforeX);
    });

    it("disconnects monitors-changed on hide", () => {
      cheatsheet.show();
      const disconnectSpy = vi.spyOn(global.display, "disconnect");
      cheatsheet.hide();
      expect(disconnectSpy).toHaveBeenCalled();
      expect(global.display.hasHandlers("monitors-changed")).toBe(false);
    });

    it("disconnects monitors-changed on destroy", () => {
      cheatsheet.show();
      // Keep the overlay parented (defer ease) so destroy exercises the live path.
      cheatsheet._overlay.ease = vi.fn();
      const disconnectSpy = vi.spyOn(global.display, "disconnect");
      cheatsheet.destroy();
      expect(disconnectSpy).toHaveBeenCalled();
      expect(global.display.hasHandlers("monitors-changed")).toBe(false);
    });
  });
});
