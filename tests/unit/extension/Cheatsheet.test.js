import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Cheatsheet } from "../../../lib/extension/cheatsheet.js";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { installGnomeGlobals, addSignalSupport } from "../../mocks/helpers/index.js";

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
      set_child_above_sibling: vi.fn(),
    };
    // Main.layoutManager emits monitors-changed (the real source the cheatsheet
    // connects to), so give it signal support alongside the uiGroup.
    Main.layoutManager = addSignalSupport({ uiGroup });

    mockExt = {
      kbdSettings: {
        list_keys: vi.fn(() => []),
        get_strv: vi.fn(() => []),
        // Real Gio.Settings.get_default_value(key) returns a GVariant; the cheatsheet
        // reads its type string to skip non-"as" keys. Default every key to "as".
        get_default_value: vi.fn(() => ({ get_type_string: () => "as" })),
        // Descriptions are read from the keybindings schema <summary>; mirror the
        // real Gio.Settings.settingsSchema -> get_key(name).get_summary() chain.
        settingsSchema: {
          get_key: vi.fn((name) => ({ get_summary: () => `summary:${name}` })),
        },
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

    it("never strands a parented overlay/backdrop if show() throws (forge-0rb6)", () => {
      // The real bug: connecting monitors-changed on the wrong object threw
      // mid-show, AFTER parenting the reactive backdrop+panel but BEFORE
      // _visible was set — leaving an input-grabbing overlay that no dismiss
      // path could clear. show() must catch any such throw and tear down.
      Main.layoutManager.connect = vi.fn(() => {
        throw new Error("No signal 'monitors-changed' on object 'MetaDisplay'");
      });

      expect(() => cheatsheet.show()).not.toThrow();

      expect(cheatsheet.visible).toBe(false);
      // Nothing cheatsheet-owned may remain parented in the uiGroup.
      expect(uiGroup.children).toHaveLength(0);
      expect(cheatsheet._backdrop).toBeNull();
    });
  });

  describe("keybinding grouping (schema-sourced descriptions)", () => {
    it("groups by prefix and takes descriptions from the schema summary", () => {
      mockExt.kbdSettings.list_keys = vi.fn(() => [
        "window-focus-left",
        "window-snap-center",
        "totally-made-up-key",
      ]);
      mockExt.kbdSettings.get_strv = vi.fn(() => ["<Super>x"]);
      const summaries = {
        "window-focus-left": "Focus window left",
        "window-snap-center": "Snap center",
        "totally-made-up-key": "", // no summary -> fall back to key-derived text
      };
      mockExt.kbdSettings.settingsSchema.get_key = vi.fn((name) => ({
        get_summary: () => summaries[name],
      }));

      const groups = new Map(cheatsheet._getGroupedKeybindings());

      // Prefix "window-focus" -> "Focus" category; description from schema summary.
      expect(groups.get("Focus")).toEqual([
        { shortcut: "Super+x", description: "Focus window left" },
      ]);
      expect(groups.get("Snap")).toEqual([{ shortcut: "Super+x", description: "Snap center" }]);
      // Unknown prefix -> "Other"; empty summary -> _keyToDescription fallback.
      expect(groups.get("Other")).toEqual([
        { shortcut: "Super+x", description: "Totally Made Up Key" },
      ]);
    });

    it("skips non-'as' keys so get_strv never trips a GLib CRITICAL (forge-u7t0)", () => {
      mockExt.kbdSettings.list_keys = vi.fn(() => ["window-focus-left", "mod-mask-mouse-tile"]);
      // mod-mask-mouse-tile is type "s"; every other shortcut key is "as".
      mockExt.kbdSettings.get_default_value = vi.fn((key) => ({
        get_type_string: () => (key === "mod-mask-mouse-tile" ? "s" : "as"),
      }));
      const getStrv = vi.fn(() => ["<Super>x"]);
      mockExt.kbdSettings.get_strv = getStrv;

      const groups = new Map(cheatsheet._getGroupedKeybindings());

      // The string-typed key is never passed to get_strv (which would log a CRITICAL).
      expect(getStrv).not.toHaveBeenCalledWith("mod-mask-mouse-tile");
      expect(getStrv).toHaveBeenCalledWith("window-focus-left");
      // ...and it does not appear in any rendered group.
      const allShortcuts = [...groups.values()].flat();
      expect(allShortcuts).toEqual([
        { shortcut: "Super+x", description: "summary:window-focus-left" },
      ]);
    });
  });

  describe("re-center on monitors-changed (forge-k5m6)", () => {
    it("connects monitors-changed on show and re-centers when geometry changes", () => {
      cheatsheet.show();
      expect(Main.layoutManager.hasHandlers("monitors-changed")).toBe(true);

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
      Main.layoutManager.emit("monitors-changed");

      expect(setPosSpy).toHaveBeenCalled();
      // New center: (800-400)/2 = 200, (600-300)/2 = 150.
      expect(overlay.x).toBe(200);
      expect(overlay.y).toBe(150);
      expect(overlay.x).not.toBe(beforeX);
    });

    it("does not throw or move the overlay when geometry is unavailable (forge-fhen.10)", () => {
      cheatsheet.show();
      const overlay = cheatsheet._overlay;
      const setPosSpy = vi.spyOn(overlay, "set_position");

      // get_monitor_geometry returns null for an invalid index (e.g. a -1 current
      // monitor mid monitors-changed). _recenter must bail, not crash on .x/.width.
      global.display.get_monitor_geometry.mockReturnValue(null);
      expect(() => Main.layoutManager.emit("monitors-changed")).not.toThrow();
      expect(setPosSpy).not.toHaveBeenCalled();
    });

    it("disconnects monitors-changed on hide", () => {
      cheatsheet.show();
      const disconnectSpy = vi.spyOn(Main.layoutManager, "disconnect");
      cheatsheet.hide();
      expect(disconnectSpy).toHaveBeenCalled();
      expect(Main.layoutManager.hasHandlers("monitors-changed")).toBe(false);
    });

    it("disconnects monitors-changed on destroy", () => {
      cheatsheet.show();
      // Keep the overlay parented (defer ease) so destroy exercises the live path.
      cheatsheet._overlay.ease = vi.fn();
      const disconnectSpy = vi.spyOn(Main.layoutManager, "disconnect");
      cheatsheet.destroy();
      expect(disconnectSpy).toHaveBeenCalled();
      expect(Main.layoutManager.hasHandlers("monitors-changed")).toBe(false);
    });
  });
});
