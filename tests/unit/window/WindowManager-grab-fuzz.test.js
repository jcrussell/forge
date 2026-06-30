import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WINDOW_MODES } from "../../../lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../lib/extension/tree.js";
import {
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
  createWindowNode,
  setPointer,
} from "../../mocks/helpers/index.js";
import { GrabOp } from "../../mocks/gnome/Meta.js";

/**
 * WindowManager grab-sequence fuzzer
 *
 * A deterministic, seeded fuzzer over Forge's grab/drag state machine. Each
 * seed replays one fully-randomized drag lifecycle against the REAL grab
 * handlers in window.js — _handleGrabOpBegin, updateMetaPositionSize ->
 * _handleMoving, _handleGrabOpEnd (incl. its focus-loss branch), _grabCleanup —
 * then asserts the post-grab invariants those handlers are responsible for.
 *
 * Targets the teardown bugs: forge-leqs (grabOp not cleared), forge-62ja (stale
 * grabOp / orphaned preview on focus-loss). A failing seed is printed so the
 * exact session is reproducible.
 */

// Small deterministic PRNG (no deps). One seed -> one replayable session.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

const LAYOUTS = ["HSPLIT", "VSPLIT", "STACKED", "TABBED"];
const TERMINATIONS = ["clean", "focus-loss", "window-close"];

// 32 fixed seeds — each is one deterministic drag session.
const SEEDS = Array.from({ length: 32 }, (_, i) => 0x5eed_0000 + i * 0x9e37);

describe("WindowManager - grab-sequence fuzzer", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
    // The fixture leaves keybindings null; allowDragDropTile() reads through it.
    ctx.extension.keybindings = { allowDragDropTile: () => true };
  });

  afterEach(() => {
    ctx.cleanup();
  });

  const buildTree = (rng, seed) => {
    const { monitor } = getWorkspaceAndMonitor(ctx);
    monitor.layout = LAYOUT_TYPES[pick(rng, LAYOUTS)];
    const ws0 = ctx.workspaces[0];
    const count = randInt(rng, 3, 4);
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const { nodeWindow } = createWindowNode(ctx.tree, monitor, {
        windowOverrides: { id: `s${seed}-w${i}`, workspace: ws0 },
      });
      nodes.push(nodeWindow);
    }
    return nodes;
  };

  for (const seed of SEEDS) {
    it(`holds grab invariants for seed ${seed}`, () => {
      const rng = mulberry32(seed);
      const wm = ctx.windowManager;

      ctx.extension.keybindings = { allowDragDropTile: () => rng() < 0.5 };

      const nodes = buildTree(rng, seed);
      const dragged = pick(rng, nodes);
      const draggedMeta = dragged.nodeValue;
      const termination = pick(rng, TERMINATIONS);
      const moveCount = randInt(rng, 0, 3);

      ctx.display.get_focus_window.mockReturnValue(draggedMeta);

      expect(() => {
        wm._handleGrabOpBegin(ctx.display, draggedMeta, GrabOp.MOVING_UNCONSTRAINED);

        for (let m = 0; m < moveCount; m++) {
          setPointer(randInt(rng, 0, 1920), randInt(rng, 0, 1080));
          wm.updateMetaPositionSize(draggedMeta, "fuzz");
        }

        if (termination === "window-close") {
          // Model the window-close path: remove the dragged node, then focus is
          // gone before the grab-op-end fires.
          ctx.tree.removeNode(dragged);
          ctx.display.get_focus_window.mockReturnValue(null);
        } else if (termination === "focus-loss") {
          ctx.display.get_focus_window.mockReturnValue(null);
        }

        wm._handleGrabOpEnd(ctx.display, draggedMeta, GrabOp.MOVING_UNCONSTRAINED);
      }, `seed ${seed} (${termination}, ${moveCount} moves)`).not.toThrow();

      const where = `seed ${seed} (${termination}, ${moveCount} moves)`;

      // No window is stranded in GRAB_TILE once the grab has ended.
      const stranded = wm.allNodeWindows.filter((n) => n.mode === WINDOW_MODES.GRAB_TILE);
      expect(stranded, `${where}: GRAB_TILE leak`).toEqual([]);

      // Per-grab state is fully released (forge-leqs / forge-62ja).
      expect(wm.grabOp, `${where}: stale grabOp`).toBeNull();
      expect(wm._draggedNodeWindow, `${where}: stale _draggedNodeWindow`).toBeNull();

      // No surviving node holds an orphaned preview overlay.
      const withPreview = wm.allNodeWindows.filter((n) => n.previewHint);
      expect(withPreview, `${where}: orphaned previewHint`).toEqual([]);

      // Tree parent-links stay consistent: every reachable window node has a
      // parent whose childNodes contains it (no orphans / dangling links).
      for (const node of wm.allNodeWindows) {
        expect(node.parentNode, `${where}: window without parent`).toBeTruthy();
        expect(
          node.parentNode.childNodes.includes(node),
          `${where}: parent does not list child`
        ).toBe(true);
      }

      // The dragged node, if closed, must be gone from the tree.
      if (termination === "window-close") {
        expect(wm.allNodeWindows.includes(dragged), `${where}: closed node still in tree`).toBe(
          false
        );
        // NODE_TYPES referenced to keep imports honest about tree shape checks.
        expect(dragged.nodeType).toBe(NODE_TYPES.WINDOW);
      }
    });
  }
});
