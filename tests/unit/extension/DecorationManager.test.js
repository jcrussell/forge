import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  createContainerNode,
} from "../../mocks/helpers/index.js";
import St from "../../mocks/gnome/St.js";

/**
 * Dedicated unit suite for lib/extension/decoration.js (DecorationManager).
 *
 * DecorationManager's methods are mixed onto WindowManager and were previously
 * only exercised incidentally by regression tests. This suite covers the two
 * decision-making entry points directly, asserting the SHOW vs HIDE outcome
 * (not merely "was called"):
 *   1. updateDecorationLayout() — the tab/stack header show/hide state machine.
 *   2. The border lifecycle — showWindowBorders() visibility gating and the
 *      idempotent _destroyActorBorder() teardown.
 */
describe("DecorationManager.updateDecorationLayout", () => {
  let ctx;
  let con;

  // A tabbed CON with two visible tiled windows is the canonical "decoration
  // should show" baseline (mirrors the forge-iwi fixture).
  function buildTabbedCon(settings) {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true, ...settings },
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    con = createContainerNode(monitor, LAYOUT_TYPES.TABBED);
    con.decoration = { show: vi.fn(), hide: vi.fn() };
    createWindowNode(ctx.tree, con, { windowOverrides: { id: "tab-a" } });
    createWindowNode(ctx.tree, con, { windowOverrides: { id: "tab-b" } });
  }

  // Add a window directly on the monitor (sibling of the CON) in a given state.
  function addMonitorWindow({ maximize = false, fullscreen = false, minimized = false } = {}) {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const { metaWindow } = createWindowNode(ctx.tree, monitor, {
      windowOverrides: { id: "other" },
    });
    if (maximize) metaWindow.maximize();
    if (fullscreen) metaWindow.make_fullscreen();
    if (minimized) metaWindow.minimized = true;
    return metaWindow;
  }

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("shows tab decorations for a CON with visible tiled children when showtab is enabled", () => {
    buildTabbedCon();

    ctx.windowManager.updateDecorationLayout();

    // Decorations are always hidden up-front, then re-shown for eligible CONs.
    expect(con.decoration.hide).toHaveBeenCalled();
    expect(con.decoration.show).toHaveBeenCalled();
  });

  it("hides decorations but never re-shows them when showtab-decoration-enabled is off", () => {
    buildTabbedCon({ "showtab-decoration-enabled": false });

    ctx.windowManager.updateDecorationLayout();

    // The up-front hide-all pass still runs, but the show gate is closed.
    expect(con.decoration.hide).toHaveBeenCalled();
    expect(con.decoration.show).not.toHaveBeenCalled();
  });

  it("early-returns (decorations stay hidden) when every window on the workspace is minimized", () => {
    buildTabbedCon();
    // Minimize both tabbed children -> allWindows.length === allHiddenWindows.length.
    con.childNodes.forEach((cn) => {
      cn.nodeValue.minimized = true;
    });

    ctx.windowManager.updateDecorationLayout();

    // Hidden by the up-front pass; the early return prevents any re-show.
    expect(con.decoration.hide).toHaveBeenCalled();
    expect(con.decoration.show).not.toHaveBeenCalled();
  });

  it("suppresses decorations on a monitor that has a visible maximized window", () => {
    buildTabbedCon();
    addMonitorWindow({ maximize: true, minimized: false });

    ctx.windowManager.updateDecorationLayout();

    expect(con.decoration.show).not.toHaveBeenCalled();
  });

  it("still shows decorations when the maximized window is merely minimized (forge-iwi)", () => {
    buildTabbedCon();
    addMonitorWindow({ maximize: true, minimized: true });

    ctx.windowManager.updateDecorationLayout();

    // A minimized maximized window covers nothing, so it must not keep the
    // tabbed decoration hidden.
    expect(con.decoration.show).toHaveBeenCalled();
  });

  it("still shows decorations when a fullscreen window is minimized (forge-iwi)", () => {
    buildTabbedCon();
    addMonitorWindow({ fullscreen: true, minimized: true });

    ctx.windowManager.updateDecorationLayout();

    expect(con.decoration.show).toHaveBeenCalled();
  });
});

// forge-zhms: a tab/stack bar was restacked directly below the FOCUSED window, so
// focusing an unrelated tiled window lifted every bar over a float covering it.
// Unit-level guard only: the Mutter restack effect itself needs the e2e check.
describe("DecorationManager tab/stack bar stacking (forge-zhms)", () => {
  let ctx;

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  // window_group (bottom -> top): [tab-a, tab-b, float, other]; `other` (a tiled
  // window outside the group) has focus. The float covers the group's bar.
  function build() {
    ctx = createWindowManagerFixture({
      settings: { "tiling-mode-enabled": true, "showtab-decoration-enabled": true },
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const con = createContainerNode(monitor, LAYOUT_TYPES.TABBED);
    const { nodeWindow: a } = createWindowNode(ctx.tree, con, { windowOverrides: { id: "tab-a" } });
    const { nodeWindow: b } = createWindowNode(ctx.tree, con, { windowOverrides: { id: "tab-b" } });
    const { nodeWindow: float } = createWindowNode(ctx.tree, monitor, {
      windowOverrides: { id: "float" },
      mode: "FLOAT",
    });
    const { nodeWindow: other, metaWindow: otherMeta } = createWindowNode(ctx.tree, monitor, {
      windowOverrides: { id: "other" },
    });
    con.decoration = { show: vi.fn(), hide: vi.fn() };
    const group = ctx.windowGroup;
    [con.decoration, a, b, float, other].forEach((n) => group.add_child(n.windowActor ?? n));
    ctx.display.get_focus_window.mockReturnValue(otherMeta);
    const stack = () => group.get_children();
    return { con, a, b, float, other, stack };
  }

  it("anchors the bar below its own container's topmost window, not the focused one", () => {
    const { con, b, float, stack } = build();

    ctx.windowManager.updateDecorationLayout();

    const order = stack();
    expect(order.indexOf(con.decoration)).toBe(order.indexOf(b.windowActor) - 1);
    expect(order.indexOf(con.decoration)).toBeLessThan(order.indexOf(float.windowActor));
  });

  it("re-anchors the bars after Mutter lowers every window actor under them", () => {
    const { con, a, b, float, other, stack } = build();
    // sync_actor_stacking lowers each window actor to the bottom in turn,
    // leaving the bar on top of every window.
    [other, float, b, a].forEach((n) =>
      ctx.windowGroup.set_child_below_sibling(n.windowActor, null)
    );
    expect(stack().at(-1)).toBe(con.decoration);

    ctx.windowManager.decorationManager.restackDecorations();

    const order = stack();
    expect(order.indexOf(con.decoration)).toBe(order.indexOf(b.windowActor) - 1);
    expect(order.indexOf(con.decoration)).toBeLessThan(order.indexOf(float.windowActor));
  });

  it("ignores a minimized member stacked above the float", () => {
    const { con, a, b, float, stack } = build();
    // b was raised over the float, then minimized: the group shows only a.
    ctx.windowGroup.set_child_above_sibling(b.windowActor, null);
    b.nodeValue.minimized = true;

    ctx.windowManager.decorationManager.restackDecorations();

    const order = stack();
    expect(order.indexOf(con.decoration)).toBe(order.indexOf(a.windowActor) - 1);
    expect(order.indexOf(con.decoration)).toBeLessThan(order.indexOf(float.windowActor));
  });
});

describe("DecorationManager border lifecycle", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "tiling-mode-enabled": true,
        "focus-border-toggle": true,
        "focus-border-hidden-on-single": false,
        "split-border-toggle": false,
        "window-gap-size": 4,
      },
    });
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  const wm = () => ctx.windowManager;

  function mockBorder() {
    return {
      set_style_class_name: vi.fn(),
      add_style_class_name: vi.fn(),
      remove_style_class_name: vi.fn(),
      set_size: vi.fn(),
      set_position: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
    };
  }

  // Two tiled HSPLIT windows; returns the focused window's border + metaWindow.
  function buildTwoTiled() {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const { metaWindow } = createWindowNode(ctx.tree, monitor, {
      windowOverrides: { id: "focused", wm_class: "TestApp" },
    });
    createWindowNode(ctx.tree, monitor, {
      windowOverrides: { id: "sibling", wm_class: "TestApp" },
    });
    const border = mockBorder();
    metaWindow.get_compositor_private().border = border;
    global.display.get_focus_window.mockReturnValue(metaWindow);
    return { border, metaWindow };
  }

  describe("showWindowBorders visibility gating (appears_focused && !minimized)", () => {
    it("shows the border when the window appears focused and is not minimized", () => {
      const { border, metaWindow } = buildTwoTiled();
      metaWindow.appears_focused = true;
      metaWindow.minimized = false;

      wm().showWindowBorders();

      expect(border.show).toHaveBeenCalled();
    });

    it("does NOT show the border when the window is minimized", () => {
      const { border, metaWindow } = buildTwoTiled();
      metaWindow.appears_focused = true;
      metaWindow.minimized = true;

      wm().showWindowBorders();

      // The border is still sized/positioned, but must not be made visible.
      expect(border.set_size).toHaveBeenCalled();
      expect(border.show).not.toHaveBeenCalled();
    });

    it("does NOT show the border when the window does not appear focused", () => {
      const { border, metaWindow } = buildTwoTiled();
      metaWindow.appears_focused = false;
      metaWindow.minimized = false;

      wm().showWindowBorders();

      expect(border.show).not.toHaveBeenCalled();
    });
  });

  describe("showWindowBorders hides the focus border for covering windows", () => {
    it("does not draw the focus border for a maximized window", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { metaWindow } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: { id: "max", wm_class: "TestApp" },
      });
      metaWindow.appears_focused = true;
      metaWindow.maximize();
      const border = mockBorder();
      metaWindow.get_compositor_private().border = border;
      global.display.get_focus_window.mockReturnValue(metaWindow);

      wm().showWindowBorders();

      // maximized() short-circuits the focus-border block: no class, no show.
      expect(border.set_style_class_name).not.toHaveBeenCalled();
      expect(border.show).not.toHaveBeenCalled();
    });

    it("does not draw the focus border for a fullscreen window", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const { metaWindow } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: { id: "fs", wm_class: "TestApp" },
      });
      metaWindow.appears_focused = true;
      metaWindow.make_fullscreen();
      const border = mockBorder();
      metaWindow.get_compositor_private().border = border;
      global.display.get_focus_window.mockReturnValue(metaWindow);

      wm().showWindowBorders();

      expect(border.set_style_class_name).not.toHaveBeenCalled();
      expect(border.show).not.toHaveBeenCalled();
    });
  });

  describe("_destroyActorBorder teardown is idempotent", () => {
    it("removes the border from window_group, hides it, and is safe to call twice", () => {
      const border = new St.Bin();
      global.window_group.add_child(border);
      const actor = { border };
      const hideSpy = vi.spyOn(border, "hide");

      expect(global.window_group.contains(border)).toBe(true);

      wm()._destroyActorBorder(actor, "border");

      // The actual teardown effect: detached from window_group and hidden.
      expect(global.window_group.contains(border)).toBe(false);
      expect(hideSpy).toHaveBeenCalled();

      // Second teardown must not throw or re-attach (no double-free).
      expect(() => wm()._destroyActorBorder(actor, "border")).not.toThrow();
      expect(global.window_group.contains(border)).toBe(false);
    });

    it("is a no-op when the named border slot is empty", () => {
      const actor = { border: null };
      expect(() => wm()._destroyActorBorder(actor, "border")).not.toThrow();
    });
  });
});
