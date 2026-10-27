import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { Diagnostics } from "../../../lib/extension/diagnostics.js";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES } from "../../../lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../../mocks/helpers/index.js";
import { Rectangle } from "../../mocks/gnome/Meta.js";

describe("Diagnostics: the local log of actions", () => {
  let ctx;
  let timers;
  let diag;
  let written;

  const wm = () => ctx.windowManager;
  const runTimers = () => {
    while (timers.length) timers.shift()();
  };
  const lines = () => diag.logText().split("\n");

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "diagnostic-log-enabled": true },
    });
    timers = [];
    written = {};
    vi.spyOn(GLib, "timeout_add").mockImplementation((_p, _ms, callback) => {
      timers.push(callback);
      return timers.length;
    });
    vi.spyOn(GLib, "file_set_contents").mockImplementation((path, bytes) => {
      written[path.split("/").pop()] = new TextDecoder().decode(bytes);
      return true;
    });
    const settings = Object.assign(ctx.settings, { connect: vi.fn(() => 7), disconnect: vi.fn() });
    const ext = { settings, extWm: wm(), metadata: { "version-name": "v-test" } };
    diag = new Diagnostics(ext);
    wm().ext.diagnostics = diag;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  // A tiled window on the active workspace, focused
  function tiledWindow(id, rect, wmClass = "kitty") {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const metaWindow = createMockWindow({
      id,
      wm_class: wmClass,
      workspace: ctx.workspaces[0],
      rect: new Rectangle(rect),
    });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    global.display.get_focus_window.mockReturnValue(metaWindow);
    return { metaWindow, node };
  }

  it("logs a shortcut, its window, and that it changed the layout", () => {
    const { metaWindow } = tiledWindow(1012, { x: 0, y: 0, width: 900, height: 1000 });

    wm().command({ name: "Focus", direction: "Left" });
    metaWindow.move_frame(true, 40, 0);
    runTimers();

    expect(lines()[0]).toMatch(/key +Focus Left +kitty#12 \(tiled in [A-Z]+\) +ok$/);
  });

  it("says why a shortcut changed nothing: the window floats", () => {
    const { node } = tiledWindow(1013, { x: 0, y: 0, width: 900, height: 1000 });
    node.mode = WINDOW_MODES.FLOAT;

    diag.runCommand({ name: "Swap", direction: "Right" }, () => {});
    runTimers();

    expect(lines()[0]).toMatch(/kitty#13 \(floating.*\) +no change: the window is floating/);
  });

  it("says why a shortcut changed nothing: tiling is off", () => {
    tiledWindow(1014, { x: 0, y: 0, width: 900, height: 1000 });
    ctx.settings.set_boolean("tiling-mode-enabled", false);

    wm().command({ name: "Move", direction: "Up" });
    runTimers();

    expect(lines()[0]).toMatch(/no change: tiling is off/);
  });

  it("logs nothing and still runs the command while the log is off", () => {
    ctx.settings.set_boolean("diagnostic-log-enabled", false);
    const run = vi.fn();

    diag.runCommand({ name: "Focus", direction: "Left" }, run);

    expect(run).toHaveBeenCalled();
    expect(diag.ring.entries).toHaveLength(0);
  });

  it("logs a command that throws, and lets the error through", () => {
    expect(() =>
      diag.runCommand({ name: "Split", orientation: "vertical" }, () => {
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(lines()[0]).toMatch(/Split vertical .*ERROR Error: boom/);
  });

  it("counts a held key as one line", () => {
    tiledWindow(1015, { x: 0, y: 0, width: 900, height: 1000 });
    for (let i = 0; i < 4; i++)
      diag.runCommand({ name: "WindowResizeRight", amount: 25 }, () => {});
    expect(diag.ring.entries).toHaveLength(1);
    expect(lines()[0]).toMatch(/WindowResizeRight \+25 ×4/);
  });

  it("marks settings commands as done without checking windows", () => {
    diag.runCommand({ name: "FocusBorderToggle" }, () => {});
    expect(timers).toHaveLength(1); // only the flush
    expect(lines()[0]).toMatch(/FocusBorderToggle .* done$/);
  });

  it("logs a mouse drag, but not the grab a keyboard resize starts", () => {
    const { metaWindow } = tiledWindow(1016, { x: 0, y: 0, width: 900, height: 1000 });

    diag.runCommand({ name: "WindowResizeLeft", amount: 25 }, () =>
      diag.grabBegin(metaWindow, 4097)
    );
    diag.grabEnd();
    expect(diag.ring.entries).toHaveLength(1);

    diag.grabBegin(metaWindow, 1 /* WINDOW_BASE: a title drag */);
    metaWindow.move_frame(true, 500, 0);
    diag.grabEnd();
    runTimers();

    expect(lines()[1]).toMatch(/mouse +drag title +kitty#16 .* ok$/);
  });

  it("logs windows opening and closing", () => {
    const { metaWindow } = tiledWindow(1017, { x: 0, y: 0, width: 900, height: 1000 });

    diag.windowOpened(metaWindow);
    diag.windowClosed(metaWindow);
    runTimers();

    expect(lines()[0]).toMatch(/window +open +kitty#17 +tiled in/);
    expect(lines()[1]).toMatch(/window +close +kitty#17/);
  });

  it("writes a BUG line, with the layout, when tiled windows overlap", () => {
    tiledWindow(1018, { x: 0, y: 40, width: 1000, height: 1000 }, "firefox");
    tiledWindow(1019, { x: 800, y: 40, width: 1000, height: 1000 });

    diag.runCommand({ name: "Focus", direction: "Left" }, () => {});
    runTimers();

    const log = diag.logText();
    expect(log).toMatch(/check +BUG\? layout +firefox#18 and kitty#19 overlap by 200x1000px/);
    expect(log).toMatch(/layout: monitor 0: [A-Z]+\[firefox#18 /);

    // The same problems aren't logged again
    diag.runCommand({ name: "Focus", direction: "Right" }, () => {});
    runTimers();
    expect(diag.logText().match(/BUG\?/g)).toHaveLength(1);

    // ...and when the windows are back in place, the log says so
    global.display.get_focus_window().move_resize_frame(true, 1000, 40, 900, 1000);
    diag.runCommand({ name: "Focus", direction: "Left" }, () => {});
    runTimers();
    expect(lines().at(-1)).toMatch(/check +layout ok again/);
  });

  it("writes the log and the screen state to files, and deletes them when turned off", () => {
    tiledWindow(1020, { x: 0, y: 0, width: 900, height: 1000 });
    diag.runCommand({ name: "Focus", direction: "Left" }, () => {});
    runTimers();

    expect(written["diagnostic.log"]).toMatch(/Focus Left/);
    expect(written["diagnostic-state.txt"]).toMatch(/Forge v-test/);
    expect(written["diagnostic-state.txt"]).toMatch(/monitor 0: 1920x1080/);

    ctx.settings.set_boolean("diagnostic-log-enabled", false);
    diag._onEnabledChanged();
    expect(diag.ring.entries).toHaveLength(0);
  });

  it("stops its timers and disconnects on destroy", () => {
    diag.runCommand({ name: "Focus", direction: "Left" }, () => {});
    const remove = vi.spyOn(GLib.Source, "remove");

    diag.destroy();

    expect(remove).toHaveBeenCalled();
    expect(ctx.settings.disconnect).toHaveBeenCalledWith(7);
  });
});
