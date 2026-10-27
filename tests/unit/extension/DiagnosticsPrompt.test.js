import { describe, it, expect, vi, beforeEach } from "vitest";
import GLib from "gi://GLib";
import { DiagnosticsPrompt } from "../../../lib/extension/diagnostics-prompt.js";
import { createMockSettings } from "../../mocks/helpers/testFixtures.js";

describe("DiagnosticsPrompt: asked once whether to keep the diagnostic log", () => {
  beforeEach(() => {
    global.get_current_time = vi.fn(() => 0);
  });

  const setup = (asked = false) => {
    const settings = createMockSettings({ "diagnostic-log-asked": asked });
    return { settings, prompt: new DiagnosticsPrompt(settings) };
  };

  it("asks a little after login, only while not asked yet", () => {
    const later = vi.spyOn(GLib, "timeout_add_seconds");
    setup(true).prompt.schedule();
    expect(later).not.toHaveBeenCalled();
    setup(false).prompt.schedule();
    expect(later).toHaveBeenCalledTimes(1);
    later.mockRestore();
  });

  it("turns the log on with the user's yes, and remembers the answer", () => {
    const { settings, prompt } = setup();
    prompt._show();
    const [notNow, turnOn] = prompt._dialog.buttons;
    expect(notNow.label).toBe("Not now");

    turnOn.action();

    expect(settings._values["diagnostic-log-enabled"]).toBe(true);
    expect(settings._values["diagnostic-log-asked"]).toBe(true);
    expect(prompt._dialog).toBeNull();
  });

  it("leaves the log off on 'Not now', and doesn't ask again", () => {
    const { settings, prompt } = setup();
    prompt._show();
    prompt._dialog.buttons[0].action();

    expect(settings._values["diagnostic-log-enabled"]).not.toBe(true);
    expect(settings._values["diagnostic-log-asked"]).toBe(true);
    prompt._show();
    expect(prompt._dialog).toBeNull();
  });
});
