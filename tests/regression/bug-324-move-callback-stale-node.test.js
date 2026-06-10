import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { Logger } from "../../lib/shared/logger.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-ne1 (#324) hardening: the Move command queues a callback that fires
 * >=220ms later and dereferenced focusNodeWindow.parentNode / nodeValue with
 * no guards. The node captured at queue time can be gone by then: the focus
 * fallback can be null, the window can close (removeChild nulls parentNode),
 * or the MetaWindow can be disposed (sleep/resume). Since the Bug #531
 * hardening the throw is swallowed by queueEvent's catch - a silent
 * "callback failed" warn and lost raise/activate/pointer-follow. The
 * callback must bail cleanly on stale nodes and keep working on live ones.
 */
describe("forge-ne1 (#324): Move's queued callback vs stale/dead nodes", () => {
  let ctx;
  let pending;
  const realTimeoutAdd = GLib.timeout_add;

  beforeEach(() => {
    pending = [];
    GLib.timeout_add = (priority, interval, cb) => {
      pending.push(cb);
      return pending.length;
    };
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    GLib.timeout_add = realTimeoutAdd;
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  // Drain captured timeout sources like the GLib main loop (throws are
  // logged-and-swallowed by queueEvent itself, never reach here).
  function flush() {
    while (pending.length) {
      const cb = pending.shift();
      if (cb() === true) pending.push(cb);
    }
  }

  function tiledWindow(id) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const win = createMockWindow({ id, wm_class: `App${id}` });
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return { win, node };
  }

  function stackedConWith(node) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const con = new Node(NODE_TYPES.CON, new Bin());
    con.layout = LAYOUT_TYPES.STACKED;
    monitor.appendChild(con);
    con.appendChild(node);
    return con;
  }

  function moveRightWithFocusOn(win) {
    ctx.display.get_focus_window.mockReturnValue(win);
    ctx.windowManager.command({ name: "Move", direction: "Right" });
  }

  it("window closed before the callback fires: clean bail, no swallowed throw", () => {
    const a = tiledWindow("A");
    tiledWindow("B");
    const warnSpy = vi.spyOn(Logger, "warn");

    moveRightWithFocusOn(a.win);
    // The close lands between the command and the 220ms callback:
    // removeChild detaches the node and nulls parentNode (tree.js).
    a.node.parentNode.removeChild(a.node);
    const raiseSpy = vi.spyOn(a.win, "raise");
    flush();

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("move callback failed"));
    expect(raiseSpy).not.toHaveBeenCalled();
  });

  it("disposed MetaWindow (sleep/resume shape): probe short-circuits before raise", () => {
    const a = tiledWindow("A");
    tiledWindow("B");
    const warnSpy = vi.spyOn(Logger, "warn");

    moveRightWithFocusOn(a.win);
    // Wherever the move landed the node, pin it inside a STACKED con so the
    // callback takes the raise/activate branch, then dispose the window:
    // every method on a finalized GJS wrapper throws.
    stackedConWith(a.node);
    const disposed = () => {
      throw new Error("Object Meta.Window (0xdead), has been already deallocated");
    };
    a.win.get_id = disposed;
    a.win.raise = disposed;
    a.win.activate = disposed;
    flush();

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("move callback failed"));
  });

  it("no tracked focus window: callback bails instead of throwing on null", () => {
    const untracked = createMockWindow({ wm_class: "UntrackedApp" });
    const warnSpy = vi.spyOn(Logger, "warn");

    moveRightWithFocusOn(untracked);
    flush();

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("move callback failed"));
  });

  it("live window in a stacked container still gets raised and re-rendered", () => {
    const a = tiledWindow("A");
    tiledWindow("B");
    const raiseSpy = vi.spyOn(a.win, "raise");

    moveRightWithFocusOn(a.win);
    stackedConWith(a.node);
    const renderSpy = vi.spyOn(ctx.windowManager, "renderTree");
    flush();

    expect(raiseSpy).toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledWith("move-stacked-queue");
  });
});
