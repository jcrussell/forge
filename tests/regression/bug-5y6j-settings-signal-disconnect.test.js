import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";
import { withSignals } from "../mocks/helpers/signalMixin.js";

/**
 * forge-5y6j: the settings "changed" handler connected in _bindSignals was the
 * only signal connection whose ID was never stored, so _removeSignals could not
 * disconnect it. After disable() the stale handler kept firing on dconf changes
 * (the old Gio.Settings stays rooted via Logger's static field) and crashed
 * into the nulled extension (`this.ext.settings is null`) on a zombie
 * WindowManager.
 *
 * Fix: store the connect ID in _settingsSignals and disconnect it in
 * _removeSignals.
 */
describe("forge-5y6j: settings 'changed' handler is disconnected on disable", () => {
  let ctx;
  let settings;

  // The fixture's settings mock has no signal system; graft the shared signal
  // mixin onto it so connect/disconnect/emit behave like a real GObject.
  function makeSignalSettings(base) {
    const SignalBox = withSignals();
    return Object.assign(new SignalBox(), base);
  }

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    settings = makeSignalSettings(ctx.extension.settings);
    ctx.extension.settings = settings;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("stops handling settings changes after _removeSignals", () => {
    const wm = ctx.windowManager;
    wm._bindSignals();

    // Sanity: while bound, a settings change reaches the real handler.
    const renderSpy = vi.spyOn(wm, "renderTree").mockImplementation(() => {});
    settings.emit("changed", settings, "tiling-mode-enabled");
    expect(renderSpy).toHaveBeenCalledWith("tiling-mode-enabled");

    wm._removeSignals();
    renderSpy.mockClear();

    // After teardown the handler must be gone — this is what crashed with
    // `this.ext.settings is null` when the extension nulled its settings.
    settings.emit("changed", settings, "tiling-mode-enabled");
    expect(renderSpy).not.toHaveBeenCalled();
    expect(settings.hasHandlers("changed")).toBe(false);
  });
});
