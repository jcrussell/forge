import { describe, it, expect, vi } from "vitest";
import Gio from "gi://Gio";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { addSignalSupport } from "../../mocks/helpers/signalMixin.js";
import { createMockWindow } from "../../mocks/helpers/mockWindow.js";
import { finalizeWindow, FINALIZED_WINDOW_ERROR } from "../../mocks/helpers/finalizeWindow.js";

/**
 * The mock connectObject/disconnectObject must behave like gnome-shell's
 * misc/signalTracker.js, or a test of production cleanup proves nothing.
 */
describe("signalMixin connectObject/disconnectObject", () => {
  it("tracks every signal/handler pair under the owner", () => {
    const settings = new Gio.Settings("x");
    const owner = {};
    const a = vi.fn();
    const b = vi.fn();
    settings.connectObject("changed::a", a, "changed::b", b, owner);

    settings.emit("changed::a");
    settings.emit("changed::b");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    settings.disconnectObject(owner);
    expect(settings.getHandlerCount("changed::a")).toBe(0);
    expect(settings.getHandlerCount("changed::b")).toBe(0);
  });

  it("disconnects only the given owner's handlers", () => {
    const settings = new Gio.Settings("x");
    const mine = {};
    const theirs = {};
    settings.connectObject("changed", () => {}, mine);
    settings.connectObject("changed", () => {}, theirs);

    settings.disconnectObject(mine);
    expect(settings.getHandlerCount("changed")).toBe(1);
  });

  it("skips a numeric flags argument after a handler", () => {
    const settings = new Gio.Settings("x");
    const owner = {};
    settings.connectObject(
      "changed::a",
      () => {},
      1,
      "changed::b",
      () => {},
      owner
    );
    expect(settings.getHandlerCount("changed::a")).toBe(1);
    expect(settings.getHandlerCount("changed::b")).toBe(1);

    settings.disconnectObject(owner);
    expect(settings.getHandlerCount("changed::a")).toBe(0);
    expect(settings.getHandlerCount("changed::b")).toBe(0);
  });

  it("tracks a call without an owner under globalThis", () => {
    const settings = new Gio.Settings("x");
    settings.connectObject("changed", () => {});
    settings.disconnectObject({});
    expect(settings.getHandlerCount("changed")).toBe(1);

    settings.disconnectObject(globalThis);
    expect(settings.getHandlerCount("changed")).toBe(0);
  });

  it("untracks when an actor owner is destroyed", () => {
    const settings = new Gio.Settings("x");
    const owner = new St.Widget();
    settings.connectObject("changed", () => {}, owner);
    expect(owner.getHandlerCount("destroy")).toBe(1);

    owner.destroy();
    expect(settings.getHandlerCount("changed")).toBe(0);
    expect(owner.getHandlerCount("destroy")).toBe(0);
  });

  it("untracks every owner when an actor emitter is destroyed", () => {
    const emitter = new St.Widget();
    emitter.connectObject("notify", () => {}, {});
    emitter.connectObject("notify", () => {}, {});
    expect(emitter.getHandlerCount("destroy")).toBe(1);

    emitter.destroy();
    expect(emitter.getHandlerCount("notify")).toBe(0);
    expect(emitter.getHandlerCount("destroy")).toBe(0);
  });

  it("never untracks a non-actor owner or emitter on its own", () => {
    const win = createMockWindow();
    const owner = { destroy() {} };
    win.connectObject("unmanaged", () => {}, owner);
    owner.destroy();
    expect(win.getHandlerCount("unmanaged")).toBe(1);
  });

  it("calls the emitter's disconnect, so a finalized window still throws", () => {
    const win = createMockWindow();
    const owner = new St.Widget();
    win.connectObject("unmanaged", () => {}, owner);
    finalizeWindow(win);
    expect(() => owner.destroy()).toThrow(FINALIZED_WINDOW_ERROR);
  });

  it("is grafted onto plain mocks and the Main EventEmitters", () => {
    const display = addSignalSupport({});
    const owner = {};
    display.connectObject("window-created", () => {}, owner);
    display.disconnectObject(owner);
    expect(display.getHandlerCount("window-created")).toBe(0);

    for (const emitter of [Main.overview, Main.layoutManager, Main.sessionMode]) {
      emitter.connectObject("updated", () => {}, owner);
      emitter.disconnectObject(owner);
      expect(emitter.getHandlerCount("updated")).toBe(0);
    }
  });
});
