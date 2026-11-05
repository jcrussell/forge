import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GLib from "gi://GLib";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../lib/extension/tree.js";
import { WINDOW_MODES } from "../../lib/extension/window.js";
import { FocusManager } from "../../lib/extension/focus.js";
import {
  createMockWindow,
  createTreeFixture,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import { MotionDirection, Rectangle } from "../mocks/gnome/Meta.js";
import { Bin } from "../mocks/gnome/St.js";

/**
 * forge-f8ka (gh-230): entering a tabbed (or stacked) group by directional
 * focus landed on its first/last tab, not the one showing, and swap() swapped
 * with a hidden tab. A group never remembered which window it shows:
 * lastTabFocus was neither kept on focus changes nor read.
 *
 * Fix: FocusManager.updateGroupFocus records the focused window in every
 * tabbed/stacked ancestor on every focus path, and Tree._selectFocusWindow
 * (focus and swap) enters a group at that window.
 */
describe("forge-f8ka: entering a group lands on the window it shows", () => {
  let ctx;
  let monitor;
  let focusManager;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    ctx.extWm.queueEvent = vi.fn();
    ctx.extWm.renderTree = vi.fn();
    focusManager = new FocusManager(ctx.tree, ctx.extWm);
    ({ monitor } = getWorkspaceAndMonitor(ctx));
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    monitor.rect = { x: 0, y: 0, width: 1920, height: 1080 };
    ctx.extWm.currentMonWsNode = monitor;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function windowNode(id, x = 0) {
    const win = createMockWindow({
      id,
      rect: new Rectangle({ x, y: 0, width: 600, height: 1080 }),
    });
    const node = new Node(NODE_TYPES.WINDOW, win);
    node.mode = WINDOW_MODES.TILE;
    return node;
  }

  function con(layout, children) {
    const node = new Node(NODE_TYPES.CON, new Bin());
    node.layout = layout;
    children.forEach((child) => node.appendChild(child));
    return node;
  }

  // HSPLIT[X, <layout>[A, B, C], Y] with B shown.
  function buildGroup(layout) {
    const nodes = {
      X: windowNode("X", 0),
      A: windowNode("A", 600),
      B: windowNode("B", 600),
      C: windowNode("C", 600),
      Y: windowNode("Y", 1200),
    };
    const group = con(layout, [nodes.A, nodes.B, nodes.C]);
    [nodes.X, group, nodes.Y].forEach((n) => monitor.appendChild(n));
    focusManager.updateGroupFocus(nodes.B);
    return { group, ...nodes };
  }

  for (const layout of [LAYOUT_TYPES.TABBED, LAYOUT_TYPES.STACKED]) {
    it(`${layout}: focusing a member records it as the group's shown window`, () => {
      const { group, B } = buildGroup(layout);
      expect(group.lastTabFocus).toBe(B.nodeValue);
    });

    it(`${layout}: focus entering from either side lands on the shown window`, () => {
      const { X, B, Y } = buildGroup(layout);
      expect(ctx.tree.focus(X, MotionDirection.RIGHT)).toBe(B);
      expect(ctx.tree.focus(Y, MotionDirection.LEFT)).toBe(B);
    });

    it(`${layout}: swap entering the group swaps with the shown window`, () => {
      const { X, B } = buildGroup(layout);
      expect(ctx.tree.swap(X, MotionDirection.RIGHT)).toBe(B);
    });
  }

  it("falls back to the entry-side window once the shown window is minimized", () => {
    const { X, A, B } = buildGroup(LAYOUT_TYPES.TABBED);
    B.nodeValue.minimized = true;
    expect(ctx.tree.focus(X, MotionDirection.RIGHT)).toBe(A);
  });

  it("enters a split that holds a group at the group's shown window", () => {
    // HSPLIT[X, VSPLIT[TABBED[A, B], D]]: entering the VSPLIT walks into the tabs.
    const X = windowNode("X", 0);
    const A = windowNode("A", 600);
    const B = windowNode("B", 600);
    const D = windowNode("D", 600);
    const tabs = con(LAYOUT_TYPES.TABBED, [A, B]);
    [X, con(LAYOUT_TYPES.VSPLIT, [tabs, D])].forEach((n) => monitor.appendChild(n));
    focusManager.updateGroupFocus(B);

    expect(ctx.tree.focus(X, MotionDirection.RIGHT)).toBe(B);
  });

  it("records the window in every enclosing group, nested ones included", () => {
    // TABBED[A, HSPLIT[B1, B2]]: focusing B2 makes the split the shown member.
    const A = windowNode("A");
    const B1 = windowNode("B1");
    const B2 = windowNode("B2");
    const tabs = con(LAYOUT_TYPES.TABBED, [A, con(LAYOUT_TYPES.HSPLIT, [B1, B2])]);
    monitor.appendChild(tabs);
    focusManager.updateGroupFocus(B2);

    expect(tabs.lastTabFocus).toBe(B2.nodeValue);
    expect(ctx.tree.shownWindow(tabs)).toBe(B2);
  });
});

describe("forge-f8ka: every focus path records the shown window", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("a window's focus signal (click, tab click, alt-tab, hover) updates lastTabFocus", () => {
    const wm = ctx.windowManager;
    const windows = ["A", "B", "C"].map((c) =>
      createMockWindow({ wm_class: c, workspace: ctx.workspaces[0] })
    );
    windows.forEach((w) => wm.trackWindow(null, w));
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    monitor.layout = LAYOUT_TYPES.TABBED;

    const captured = [];
    vi.spyOn(wm, "queueEvent").mockImplementation((eventObj) => captured.push(eventObj));
    ctx.display.get_focus_window.mockReturnValue(windows[1]);
    windows[1].emit("focus", windows[1]);
    captured.find((e) => e.name === "focus-update").callback();

    expect(monitor.lastTabFocus).toBe(windows[1]);
  });
});

describe("forge-f8ka: a window that tiles again without a focus change is recorded", () => {
  let ctx;
  let group;
  let A;
  let B;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    group = new Node(NODE_TYPES.CON, new Bin());
    group.layout = LAYOUT_TYPES.TABBED;
    monitor.appendChild(group);
    [A, B] = ["A", "B"].map((id) => {
      const win = createMockWindow({ id, wm_class: id, workspace: ctx.workspaces[0] });
      const node = ctx.tree.createNode(group.nodeValue, NODE_TYPES.WINDOW, win);
      node.mode = WINDOW_MODES.TILE;
      return node;
    });
    // B was the shown tab; A is floating and has focus (focusing a float
    // records nothing).
    group.lastTabFocus = B.nodeValue;
    A.mode = WINDOW_MODES.FLOAT;
    ctx.display.get_focus_window.mockReturnValue(A.nodeValue);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("processFloats tiling the focused window records it as its group's shown window", () => {
    ctx.windowManager.processFloats();

    expect(A.isTile()).toBe(true);
    expect(group.lastTabFocus).toBe(A.nodeValue);
  });

  it("does not record an unfocused window that tiles again", () => {
    ctx.display.get_focus_window.mockReturnValue(B.nodeValue);

    ctx.windowManager.processFloats();

    expect(A.isTile()).toBe(true);
    expect(group.lastTabFocus).toBe(B.nodeValue);
  });

  it("FloatToggle back to tiled leaves the toggled window as the shown tab", () => {
    const idle = [];
    vi.spyOn(GLib, "idle_add").mockImplementation((_priority, cb) => idle.push(cb) && idle.length);
    // A floats by a per-window override that FloatToggle drops again.
    const exempt = vi.spyOn(ctx.windowManager, "isFloatingExempt").mockReturnValue(true);
    vi.spyOn(ctx.windowManager, "removeFloatOverride").mockImplementation(() =>
      exempt.mockReturnValue(false)
    );

    ctx.windowManager.command({ name: "FloatToggle", mode: "float" });
    while (idle.length) idle.shift()();

    expect(A.isTile()).toBe(true);
    expect(group.lastTabFocus).toBe(A.nodeValue);
  });
});

describe("forge-f8ka: a swap between groups updates both groups' shown window", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "tiling-mode-enabled": true } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  it("HSPLIT[STACKED_A[P, X], STACKED_B[Y, Q]]: swapping X right into Y's slot", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx, 0, 0);
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    const stack = (ids) => {
      const con = new Node(NODE_TYPES.CON, new Bin());
      con.layout = LAYOUT_TYPES.STACKED;
      monitor.appendChild(con);
      const nodes = ids.map((id) => {
        const win = createMockWindow({ id, wm_class: id, workspace: ctx.workspaces[0] });
        const node = ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, win);
        node.mode = WINDOW_MODES.TILE;
        return node;
      });
      return { con, nodes };
    };
    const a = stack(["P", "X"]);
    const b = stack(["Y", "Q"]);
    const [, X] = a.nodes;
    const [Y] = b.nodes;
    a.con.lastTabFocus = X.nodeValue;
    b.con.lastTabFocus = Y.nodeValue;
    ctx.display.get_focus_window.mockReturnValue(X.nodeValue);

    ctx.windowManager.command({ name: "Swap", direction: "right" });

    expect(X.parentNode).toBe(b.con);
    expect(Y.parentNode).toBe(a.con);
    expect(b.con.lastTabFocus).toBe(X.nodeValue);
    expect(a.con.lastTabFocus).toBe(Y.nodeValue);
  });
});
