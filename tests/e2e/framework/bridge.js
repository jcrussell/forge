// Forge E2E test bridge (forge-1gu).
//
// Installed ONCE per ShellProxy connection into gnome-shell's persistent Eval global as
// `globalThis._forgeTestBridge`, then invoked by thin Python call sites in shell_proxy.py
// (e.g. `globalThis._forgeTestBridge.getTreeStructure()`). Centralizes the three things that
// were copy-pasted across ~15 tree-query Shell.Eval snippets: Forge root resolution, the
// {x,y,width,height} rect projection, and the recursive tree walk (as a few small combinators,
// NOT one universal walker).
//
// Runs in gnome-shell's `Eval` scope (GJS). Phase-0 verified (see
// e2e-bridge-cross-eval-main-resolution): a function defined here and called from a later,
// separate Eval STILL resolves the bare `Main` Eval-global. Use bare `Main` — NOT
// imports.ui.main, which throws "import declarations may only appear at top level of a module"
// on GNOME 49 (ESM) because the legacy imports.ui.* loader can't load the ES-module ui/main.js.
//
// Each method returns the SAME value/sentinel its old inline body returned, so the Python call
// sites stay byte-identical: object methods `return JSON.stringify(...)`, others return a bare
// string ('ERROR'/'-1'/'false'/'NO_NODE'/...) or String(n).
//
// eslint-env: this is GJS, not Node/browser. `Main`, `global`, `imports` and the GI namespaces
// are gnome-shell Eval globals declared in eslint.config.js (forge-mpt). `Main` stays in the
// inline directive below because it is the one bare-name Eval global that isn't a GI namespace;
// `globalThis` is a JS built-in (no directive needed).
/* global Main */

(function () {
  if (globalThis._forgeTestBridge) return "ok"; // idempotency belt-and-suspenders (Python flag is primary guard)

  const FORGE_UUID = "forge@jmmaranan.com";

  // Resolve GI namespaces ONCE at install time and capture them in the method closures.
  // imports.gi.* works in the Eval scope; capturing here avoids re-importing per call and
  // sidesteps any question of imports.* reachability from a later eval (Phase 0 only verified
  // bare `Main`). Meta: count_maximized_windows (MaximizeFlags fallback). Clutter/St:
  // the virtual-input + overlay helpers folded in from shell_proxy.py (forge-9q3).
  const Meta = imports.gi.Meta;
  const Clutter = imports.gi.Clutter;
  const St = imports.gi.St;

  // --- Forge root resolution (absorbs _forge_root_js) -----------------------------------------
  // `class Tree extends Node` and its ctor calls super(NODE_TYPES.ROOT, ...) (lib/extension/
  // tree.js), so the Tree instance IS the root node — there is no `.root` property (forge-g14).
  // Re-resolves EVERY call: a Forge disable/enable does NOT clear globalThis, so this stays
  // correct without any cache invalidation. Returns null when Forge or its tree is unavailable;
  // callers map that null to their own sentinel.
  function root() {
    const forge = Main.extensionManager.lookup(FORGE_UUID);
    if (!forge || !forge.stateObj) return null;
    const ext = forge.stateObj;
    if (!ext.extWm || !ext.extWm.tree) return null;
    return ext.extWm.tree;
  }

  // Forge's stateObj (the extension's runtime state), or null if Forge isn't loaded. Used by
  // the non-tree methods that read configMgr / settings / extWm.windowProps rather than the tree.
  function forgeExt() {
    const forge = Main.extensionManager.lookup(FORGE_UUID);
    return forge && forge.stateObj ? forge.stateObj : null;
  }

  // --- Rect projection (absorbs the ~8 {x,y,width,height} copies) ------------------------------
  function rect(r) {
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }

  // --- Traversal combinators (small + explicit, NOT one universal walker) ----------------------

  // Pre-order first-match. Returns the first node for which pred(node) is truthy, else null.
  // Absorbs findNodeByClass / findNodeByWindow. No depth guard (matches the originals).
  function firstMatch(node, pred) {
    if (!node) return null;
    if (pred(node)) return node;
    for (const child of node.childNodes || []) {
      const found = firstMatch(child, pred);
      if (found) return found;
    }
    return null;
  }

  // Pre-order reduce. fn(acc, node) -> { acc, descend? }; recursion into a node's children is
  // skipped when fn returns descend === false. The explicit `descend` flag is what lets this one
  // combinator express both countWindows (STOP at WINDOW nodes) and countDescendants / the tiled
  // walk (visit everything) without a hidden policy.
  function reduceTree(node, fn, seed) {
    if (!node) return seed;
    const r = fn(seed, node);
    let acc = r.acc;
    if (r.descend !== false) {
      for (const child of node.childNodes || []) {
        acc = reduceTree(child, fn, acc);
      }
    }
    return acc;
  }

  // Nested-object build. project(node, mappedChildren) -> object. Children are mapped first
  // (depth-first). maxDepth null = unbounded (get_forge_tree); a number caps depth, returning
  // null past it (get_tree_structure uses 10) — the null lands in the parent's children array,
  // matching the original serializeNode behavior. Absorbs the two divergent serializeNodes.
  function mapTree(node, project, maxDepth, depth) {
    depth = depth || 0;
    if (!node) return null;
    if (maxDepth != null && depth > maxDepth) return null;
    const children = (node.childNodes || []).map((c) => mapTree(c, project, maxDepth, depth + 1));
    return project(node, children);
  }

  // Predicate helper: a WINDOW node whose Meta.Window has the given wm_class. Only windows
  // expose get_wm_class(), so non-window nodes never match.
  function isWindowOfClass(node, wmClass) {
    const v = node.nodeValue;
    return !!(v && v.get_wm_class && v.get_wm_class() === wmClass);
  }

  globalThis._forgeTestBridge = {
    // expose primitives for reuse / debugging
    root,
    rect,
    firstMatch,
    reduceTree,
    mapTree,

    // === POC methods (Phase 2) — one per combinator. Byte-identical to their old inline bodies. ===

    // firstMatch — was get_forge_node_for_window (shell_proxy.py:362)
    getForgeNodeForWindow(wmClass) {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const node = firstMatch(r, (n) => isWindowOfClass(n, wmClass));
        if (!node) return JSON.stringify(null);
        return JSON.stringify({
          nodeType: node.nodeType,
          layout: node.layout,
          parentLayout: node.parentNode?.layout,
          rect: node.rect, // raw (the original did NOT project here)
        });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // forge-kvao/forge-s6g: shadow get_size_hints on the LEFTMOST window of a
    // class so the min-size redistribution can be exercised deterministically in
    // e2e (no headless app reports a large min-width). The own-property override
    // lives on the live Meta.Window and so survives the async render cycle. A
    // re-render is triggered so computeSizes re-runs with the injected minimum.
    setLeftmostWindowMinSize(wmClass, minWidth, minHeight) {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const wins = reduceTree(
          r,
          (acc, n) => {
            if (isWindowOfClass(n, wmClass)) acc.push(n);
            return { acc };
          },
          []
        );
        if (wins.length === 0) return JSON.stringify({ error: "no windows of class" });
        const target = wins.reduce((a, b) =>
          b.nodeValue.get_frame_rect().x < a.nodeValue.get_frame_rect().x ? b : a
        );
        const win = target.nodeValue;
        if (!win._origGetSizeHints) win._origGetSizeHints = win.get_size_hints;
        win.get_size_hints = () => ({ min_width: minWidth, min_height: minHeight });
        const ext = forgeExt();
        if (ext && ext.extWm) ext.extWm.renderTree("e2e-minsize");
        return JSON.stringify({ ok: true, id: win.get_id(), rect: rect(win.get_frame_rect()) });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // forge-kvao: undo setLeftmostWindowMinSize for every shadowed window of the
    // class and re-render, so the change does not leak into later tests.
    resetWindowMinSize(wmClass) {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const count = reduceTree(
          r,
          (acc, n) => {
            const v = n.nodeValue;
            if (isWindowOfClass(n, wmClass) && v._origGetSizeHints) {
              v.get_size_hints = v._origGetSizeHints;
              delete v._origGetSizeHints;
              return { acc: acc + 1 };
            }
            return { acc };
          },
          0
        );
        const ext = forgeExt();
        if (ext && ext.extWm) ext.extWm.renderTree("e2e-minsize-reset");
        return JSON.stringify({ ok: true, reset: count });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // mapTree — was get_tree_structure (shell_proxy.py:1109), depth guard 10
    getTreeStructure() {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const project = (node, children) => ({
          nodeType: node.nodeType,
          layout: node.layout,
          childCount: node.childNodes ? node.childNodes.length : 0,
          wmClass: node.nodeValue?.get_wm_class?.() || null,
          title: node.nodeValue?.title || null,
          children: children,
        });
        return JSON.stringify(mapTree(r, project, 10));
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // reduceTree — was count_tiled_windows_of_class (shell_proxy.py:520). Visits all nodes;
    // counts WINDOW nodes of the class whose mode !== 'FLOAT'.
    countTiledWindowsOfClass(wmClass) {
      try {
        const r = root();
        if (!r) return "-1";
        const tiled = reduceTree(
          r,
          (acc, n) => {
            const hit =
              n.nodeType === "WINDOW" && isWindowOfClass(n, wmClass) && n.mode !== "FLOAT";
            return { acc: hit ? acc + 1 : acc };
          },
          0
        );
        return String(tiled);
      } catch (e) {
        return "-1";
      }
    },

    // === Remaining tree methods (Phase 3). Each byte-identical to its old inline body. ===

    // mapTree, NO depth guard — was get_forge_tree (shell_proxy.py:235)
    getForgeTree() {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const project = (node, children) => ({
          nodeType: node.nodeType,
          layout: node.layout,
          rect: rect(node.rect),
          children: children,
          windowTitle: node.nodeValue?.title || null,
          wmClass: node.nodeValue?.get_wm_class ? node.nodeValue.get_wm_class() : null,
        });
        return JSON.stringify(mapTree(r, project, null));
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // firstMatch by focused window, with the original focus-activation side effect — was
    // get_container_layout (shell_proxy.py:394)
    getContainerLayout() {
      try {
        const r = root();
        if (!r) return "ERROR";
        let focusWindow = global.display.get_focus_window();
        if (!focusWindow) {
          const ws = global.workspace_manager.get_active_workspace();
          const wins = ws.list_windows();
          if (wins.length > 0) {
            wins[0].activate(global.get_current_time());
            focusWindow = wins[0];
          }
        }
        if (!focusWindow) return "NO_FOCUS";
        const windowNode = firstMatch(r, (n) => n.nodeValue === focusWindow);
        if (!windowNode || !windowNode.parentNode) return "NO_NODE";
        return windowNode.parentNode.layout || "UNKNOWN";
      } catch (e) {
        return "ERROR";
      }
    },

    // firstMatch by class, mode check — was is_window_floating (shell_proxy.py:430)
    isWindowFloating(wmClass) {
      try {
        const r = root();
        if (!r) return "false";
        const node = firstMatch(r, (n) => isWindowOfClass(n, wmClass));
        if (!node) return "false";
        return node.mode === "FLOAT" ? "true" : "false";
      } catch (e) {
        return "false";
      }
    },

    // firstMatch by focused-window identity — was is_focused_window_floating (shell_proxy.py:467)
    isFocusedWindowFloating() {
      try {
        const r = root();
        if (!r) return "false";
        const fw = global.display.get_focus_window();
        if (!fw) return "false";
        const node = firstMatch(r, (n) => n.nodeValue === fw);
        if (!node) return "false";
        return node.mode === "FLOAT" ? "true" : "false";
      } catch (e) {
        return "false";
      }
    },

    // reduceTree, STOP at WINDOW nodes (descend:false) — was get_window_count (shell_proxy.py:902)
    getWindowCount() {
      try {
        const r = root();
        // forge-t3bb: an unresolvable Forge root means the extension is dead or
        // disabled — that must not look identical to "0 windows".
        if (!r) return "ERR_NO_ROOT";
        const count = reduceTree(
          r,
          (acc, n) => (n.nodeType === "WINDOW" ? { acc: acc + 1, descend: false } : { acc }),
          0
        );
        return String(count);
      } catch (e) {
        return "ERR_" + e;
      }
    },

    // firstMatch by class + projection — was get_node_for_window (shell_proxy.py:1007)
    getNodeForWindow(wmClass) {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const windowNode = firstMatch(r, (n) => isWindowOfClass(n, wmClass));
        if (!windowNode) return JSON.stringify({ error: "Window not found in tree" });
        const parent = windowNode.parentNode;
        return JSON.stringify({
          nodeType: windowNode.nodeType,
          layout: windowNode.layout,
          parentNodeType: parent?.nodeType || null,
          parentLayout: parent?.layout || null,
          siblingCount: parent ? parent.childNodes.length : 0,
          rect: rect(windowNode.rect),
        });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // firstMatch by class — was get_parent_layout (shell_proxy.py:1049)
    getParentLayout(wmClass) {
      try {
        const r = root();
        if (!r) return "ERROR";
        const windowNode = firstMatch(r, (n) => isWindowOfClass(n, wmClass));
        if (!windowNode || !windowNode.parentNode) return "NO_NODE";
        return windowNode.parentNode.layout || "UNKNOWN";
      } catch (e) {
        return "ERROR";
      }
    },

    // firstMatch by class — was get_sibling_count (shell_proxy.py:1077)
    getSiblingCount(wmClass) {
      try {
        const r = root();
        if (!r) return "ERR_NO_ROOT";
        const windowNode = firstMatch(r, (n) => isWindowOfClass(n, wmClass));
        if (!windowNode || !windowNode.parentNode) return "0";
        return String(windowNode.parentNode.childNodes.length);
      } catch (e) {
        return "0";
      }
    },

    // bespoke path-threading search (NOT firstMatch) — was get_focused_node_path
    // (shell_proxy.py:1142). Returns the path array from root to the focused window.
    getFocusedNodePath() {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const focusWindow = global.display.get_focus_window();
        if (!focusWindow) return JSON.stringify({ error: "No focused window" });
        function findNodePath(node, metaWindow, path) {
          if (!node) return null;
          const currentPath = [...path, { nodeType: node.nodeType, layout: node.layout }];
          if (node.nodeValue === metaWindow) return currentPath;
          for (const child of node.childNodes || []) {
            const found = findNodePath(child, metaWindow, currentPath);
            if (found) return found;
          }
          return null;
        }
        const nodePath = findNodePath(r, focusWindow, []);
        return JSON.stringify(nodePath || []);
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // firstMatch for a >=2-child container of `layout`, then activate its LAST window child.
    // WF4 (forge-fjs) asserts focus MOVES between genuine stacked/tabbed siblings, but which
    // window Mutter leaves focused after launch_window() varies by GNOME version (the d801a7d
    // family) — so the test must establish the precondition rather than assume it. Activating
    // the last child (which always has a previous sibling) lets a subsequent focus toward the
    // previous sibling (focus_up in STACKED, focus_left in TABBED) move deterministically on
    // every version. activate() is a direct Mutter call, not synthetic input, so it is reliable
    // where the keybinding path is not (forge-er8). Returns the activated window's id, else {error}.
    activateLastSiblingOf(layout) {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const container = firstMatch(
          r,
          (n) => n.layout === layout && (n.childNodes || []).length >= 2
        );
        if (!container) {
          return JSON.stringify({ error: "No >=2-child " + layout + " container" });
        }
        const children = container.childNodes;
        const metaWindow = children[children.length - 1].nodeValue;
        if (!metaWindow || !metaWindow.activate) {
          return JSON.stringify({ error: "Last child of " + layout + " is not a window" });
        }
        metaWindow.activate(global.get_current_time());
        return JSON.stringify({ id: metaWindow.get_id() });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // firstMatch by class + sibling projection — was get_window_siblings (shell_proxy.py:1177)
    getWindowSiblings(wmClass) {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const windowNode = firstMatch(r, (n) => isWindowOfClass(n, wmClass));
        if (!windowNode || !windowNode.parentNode) return JSON.stringify([]);
        const siblings = windowNode.parentNode.childNodes.map((sibling) => ({
          nodeType: sibling.nodeType,
          wmClass: sibling.nodeValue?.get_wm_class?.() || null,
          rect: rect(sibling.rect),
          childCount: sibling.childNodes ? sibling.childNodes.length : 0,
        }));
        return JSON.stringify(siblings);
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // bespoke explicit-stack walk (parent-ref + depth>20 guard) — was verify_tree_integrity
    // (shell_proxy.py:1217). Root's _parent is null and the walk seeds parent:null, so the
    // root's parentNode check is null===null (no spurious depth-0 error).
    verifyTreeIntegrity() {
      try {
        const r = root();
        if (!r) return JSON.stringify({ valid: false, errors: ["Tree not available"] });
        const errors = [];
        const stack = [{ node: r, parent: null, depth: 0 }];
        while (stack.length > 0) {
          const item = stack.pop();
          if (!item.node) continue;
          if (item.depth > 20) {
            errors.push("Tree depth exceeds 20 - possible cycle");
            continue;
          }
          if (item.node.parentNode !== item.parent) {
            errors.push("Node has incorrect parent reference at depth " + item.depth);
          }
          const children = item.node.childNodes || [];
          for (let i = 0; i < children.length; i++) {
            stack.push({ node: children[i], parent: item.node, depth: item.depth + 1 });
          }
        }
        return JSON.stringify({ valid: errors.length === 0, errors: errors });
      } catch (e) {
        return JSON.stringify({ valid: false, errors: [String(e)] });
      }
    },

    // === Fuzzer support (forge-cnrc) ===========================================================
    // The live fuzzer (tests/e2e/fuzz/) drives random action sequences and, after each one,
    // needs (a) a POSITIVE settle and (b) a deep, SOUND invariant oracle.
    //
    // (a) fuzzRenderNow() forces tree.render() SYNCHRONOUSLY. command()/renderTree() only QUEUE
    //     a GLib.idle_add render (window.js:1432-1457) and return before it fires, so a naive
    //     read races the pre-cleanup tree (stale empty/single-child CONs, unflattened nodes).
    //     render() is fully synchronous and single-threaded (tree.js:1838), and it runs
    //     cleanTree() itself — so after this call the tree is in its settled, post-cleanup shape.
    //
    // (b) fuzzCheckInvariants() walks once and returns {valid, violations:[{rule,detail,path}]}.
    //     ONLY rules that are TRUE invariants of a correct tree are checked — three plausible
    //     rules were deliberately REJECTED after reading the code, do NOT re-add them:
    //       * "child percents sum to 1.0" — FALSE. computeSizes (tree.js:2357) sizes each child
    //         independently and never normalizes siblings to 1.0; floated children keep stale
    //         nonzero percents. Correct trees routinely sum to neither 1.0 nor all-0.0.
    //       * "no CON with 0 TILED children" — FALSE. cleanTree removes CONs with
    //         childNodes.length===0 (tree.js:1879), NOT getTiledChildren()===0. A CON whose
    //         windows are all floated/minimized legitimately has 0 tiled children and survives.
    //       * "no single-WINDOW-child CON" — FALSE. cleanTree only flattens a CON whose lone
    //         child is itself a CON (tree.js:1905). Closing HSPLIT[CON[W1,W2],W3]->W2 leaves a
    //         valid CON[W1]. Only the single-CON-child case is the invariant.
    fuzzRenderNow() {
      try {
        const ext = forgeExt();
        if (!ext || !ext.extWm || !ext.extWm.tree) return "no-tree";
        ext.extWm.tree.render("e2e-fuzz");
        return "ok";
      } catch (e) {
        return "render-threw: " + e.message;
      }
    },

    // Revert STACKED/TABBED layout that LayoutStackedToggle / WorkspaceMonocleToggle leave on a
    // MONITOR or WORKSPACE node when the workspace is flat (no CON to absorb the toggle —
    // command.js:327). That layout persists in the tree and BLEEDS into the next seed in a
    // CONTINUE=1 run, breaking deterministic replay. Reset each such node back to its natural
    // per-monitor split default (determineSplitLayoutForRect, used at monitor.js:66; null-safe,
    // so it also handles a WORKSPACE node with no rect). CON nodes legitimately carry STACKED/
    // TABBED and ROOT keeps its ROOT layout, so both are left alone.
    fuzzResetNodeLayouts() {
      try {
        const ext = forgeExt();
        const wm = ext && ext.extWm;
        if (!wm || !wm.tree) return "no-tree";
        let reset = 0;
        reduceTree(
          wm.tree,
          (acc, n) => {
            const t = n.nodeType;
            if (
              (t === "MONITOR" || t === "WORKSPACE") &&
              (n.layout === "STACKED" || n.layout === "TABBED")
            ) {
              n.layout = wm.determineSplitLayoutForRect(n.rect);
              reset += 1;
            }
            return { acc };
          },
          null
        );
        return String(reset);
      } catch (e) {
        return "reset-threw: " + e.message;
      }
    },

    // opts: { gap?: number, tol?: number, render?: boolean }. gap = the configured window gap
    // (px); tol = extra slack on overlap (px). When render !== false, force a synchronous render
    // first so the oracle reads the settled tree (see fuzzRenderNow above).
    fuzzCheckInvariants(opts) {
      const o = opts || {};
      const gap = typeof o.gap === "number" ? o.gap : 0;
      const tol = typeof o.tol === "number" ? o.tol : 2;
      const violations = [];
      const add = (rule, detail, path) => violations.push({ rule, detail, path });
      try {
        if (o.render !== false) {
          const ext = forgeExt();
          if (ext && ext.extWm && ext.extWm.tree) {
            try {
              ext.extWm.tree.render("e2e-fuzz-check");
            } catch (e) {
              add("render-threw", e.message, "root");
              return JSON.stringify({ valid: false, violations });
            }
          }
        }
        const r = root();
        if (!r)
          return JSON.stringify({
            valid: false,
            violations: [{ rule: "tree-unavailable", detail: "Tree not available", path: "root" }],
          });

        // String enums (createEnum maps each name to itself, enum.js): nodeType/layout/mode are
        // the bare strings below — see NODE_TYPES/LAYOUT_TYPES (tree.js:37,45) and WINDOW_MODES
        // (window.js:60).
        const NODE_TYPES_OK = { ROOT: 1, MONITOR: 1, CON: 1, WINDOW: 1, WORKSPACE: 1 };
        const LAYOUTS_OK = { STACKED: 1, TABBED: 1, ROOT: 1, HSPLIT: 1, VSPLIT: 1, PRESET: 1 };
        const SPLITS = { HSPLIT: 1, VSPLIT: 1 };

        // m4: a real cycle check (visited-identity Set) replaces the old depth>20 heuristic —
        // base depth is already 3 and nested HSPLIT/VSPLIT never flatten, so depth alone was a
        // false-positive on legitimately deep trees. m5: seenWinIds detects two WINDOW nodes
        // wrapping the same Meta.Window.
        const visited = new Set();
        const seenWinIds = new Set();
        // Depth/size metrics (forge-cnrc): the fuzzer was found to explore wide-but-FLAT trees;
        // these expose the ACHIEVED shape so a run can show whether it actually builds depth.
        let maxDepth = 0;
        let nodes = 0;
        let cons = 0;
        let maxSplitFanout = 0; // max children under any HSPLIT/VSPLIT
        const stack = [{ node: r, parent: null, depth: 0, path: "root" }];
        while (stack.length > 0) {
          const item = stack.pop();
          const n = item.node;
          if (!n) continue;
          // m4: re-encountering a node IS the cycle — flag it and stop descending so the walk
          // terminates, rather than guessing from depth.
          if (visited.has(n)) {
            add("cycle", "node re-encountered during walk (cycle)", item.path);
            continue;
          }
          visited.add(n);
          nodes++;
          if (item.depth > maxDepth) maxDepth = item.depth;
          if (n.nodeType === "CON") cons++;
          if (n.layout === "HSPLIT" || n.layout === "VSPLIT") {
            const fan = (n.childNodes || []).length;
            if (fan > maxSplitFanout) maxSplitFanout = fan;
          }
          // m4: generous backstop against a pathologically deep (but acyclic) tree; no longer
          // described as a cycle, and high enough that real trees are always fully walked.
          if (item.depth > 256) {
            add("depth-exceeded", "tree depth > 256", item.path);
            continue;
          }
          if (n.parentNode !== item.parent)
            add("parent-ref", "parentNode does not match walk parent", item.path);
          if (!NODE_TYPES_OK[n.nodeType])
            add("node-type-domain", "unknown nodeType " + n.nodeType, item.path);
          if (n.layout != null && !LAYOUTS_OK[n.layout])
            add("layout-domain", "unknown layout " + n.layout, item.path);

          const children = n.childNodes || [];
          if (n.nodeType === "CON") {
            if (children.length === 0)
              add("empty-con", "CON with 0 children survived render", item.path);
            else if (children.length === 1 && children[0].nodeType === "CON")
              add(
                "con-single-con-child",
                "CON wrapping a single CON should be flattened",
                item.path
              );
          }
          if (n.nodeType === "WINDOW") {
            // m5: a WINDOW is a leaf by construction; any child means a corrupt insert.
            if (children.length > 0)
              add("window-not-leaf", "WINDOW node has " + children.length + " children", item.path);
            const w = n.nodeValue;
            let alive = false;
            let wid = null;
            try {
              if (w && typeof w.get_id === "function") wid = w.get_id();
              alive = !!(w && wid != null);
            } catch (e) {
              alive = false;
              wid = null;
            }
            if (!alive)
              add("dead-window-ref", "WINDOW node with dead/disposed Meta.Window", item.path);
            // m5: two distinct WINDOW nodes sharing one Meta.Window id is a duplicated mapping.
            else if (wid != null) {
              if (seenWinIds.has(wid))
                add("duplicate-window", "Meta.Window id " + wid + " mapped twice", item.path);
              else seenWinIds.add(wid);
            }
          }

          // Geometry: pairwise non-overlap of a split's direct tiled children. STACKED/TABBED are
          // skipped by construction (children fully overlap there by design — that is correct).
          if (SPLITS[n.layout]) {
            // B2: ask the shell's OWN getTiledChildren (tree.js:1290) which children are in the
            // layout. A CON whose windows are all floated is excluded there but keeps a STALE rect
            // (removeNode zeroes only percent, never rect), so iterating raw childNodes would
            // false-positive it against its expanded sibling. getTiledChildren already excludes
            // float/grab/minimized and correctly INCLUDES DEFAULT-mode tiled windows.
            let tiled;
            try {
              tiled = r.getTiledChildren(children);
            } catch (e) {
              tiled = [];
            }
            // From the tiled set additionally drop any node with a non-positive rect
            // (transient/collapsed) and any fullscreen OR maximized WINDOW (its rect is the whole
            // monitor by design — would overlap every sibling).
            const eligible = tiled.map((c) => {
              const rc = c.rect;
              if (!rc || rc.width <= 0 || rc.height <= 0) return null;
              if (c.nodeType === "WINDOW") {
                try {
                  const w = c.nodeValue;
                  if (w && w.is_fullscreen && w.is_fullscreen()) return null;
                  if (w && w.get_maximized && w.get_maximized()) return null;
                } catch (e) {
                  return null;
                }
              }
              return rc;
            });
            for (let i = 0; i < tiled.length; i++) {
              const a = eligible[i];
              if (!a) continue;
              for (let j = i + 1; j < tiled.length; j++) {
                const b = eligible[j];
                if (!b) continue;
                const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
                const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
                if (ox > gap + tol && oy > gap + tol) {
                  add(
                    "tiled-overlap",
                    "siblings overlap " + ox + "x" + oy + "px under " + n.layout,
                    item.path + "[" + i + "," + j + "]"
                  );
                }
              }
            }
          }

          for (let i = 0; i < children.length; i++) {
            stack.push({
              node: children[i],
              parent: n,
              depth: item.depth + 1,
              path: item.path + "/" + i + ":" + (children[i] ? children[i].nodeType : "null"),
            });
          }
        }
        return JSON.stringify({
          valid: violations.length === 0,
          violations,
          stats: { maxDepth, nodes, cons, maxSplitFanout },
        });
      } catch (e) {
        return JSON.stringify({
          valid: false,
          violations: [{ rule: "oracle-threw", detail: String(e), path: "root" }],
        });
      }
    },

    // M3: quiescence probe so the Python settle can wait for async finalize to drain. Move /
    // SnapLayoutMove finalize through wm.queueEvent, which enqueues onto wm.eventQueue (a Queue,
    // tree.js:758, with a .length getter) and drains via a GLib.timeout (window.js:271); a render
    // is then a GLib.idle_add tracked by wm._renderTreeSrcId (window.js:1439). So:
    //   queue         = eventQueue.length (pending queued events; 0 if the structure is missing)
    //   pendingRender = !!_renderTreeSrcId (an idle render is scheduled but hasn't fired)
    //   busy          = queue > 0 || pendingRender
    // Never throws — returns {busy:false,...} on any error.
    fuzzPendingWork() {
      try {
        const ext = forgeExt();
        const wm = ext && ext.extWm;
        let queue = 0;
        if (wm && wm.eventQueue && typeof wm.eventQueue.length === "number") {
          queue = wm.eventQueue.length;
        }
        const pendingRender = !!(wm && wm._renderTreeSrcId);
        return JSON.stringify({ busy: queue > 0 || pendingRender, queue, pendingRender });
      } catch (e) {
        return JSON.stringify({ busy: false, queue: 0, pendingRender: false });
      }
    },

    // Apply a Meta.Window STATE op to a positionally-selected window, for the fuzzer's
    // window-state class (forge-cnrc). These are raw Mutter ops (NOT Forge commands) that
    // exercise Forge's reaction paths: minimize/unminimize (leaves/rejoins the tile tree) and
    // fullscreen (triggers _reconcileFullscreenFloatDemotion). Both states are oracle-safe
    // (minimized + fullscreen windows are skipped in the overlap check). opts: {op, focus}.
    fuzzWindowState(opts) {
      try {
        const o = opts || {};
        const op = o.op;
        const hint = o.focus || null;
        const wins = global.workspace_manager.get_active_workspace().list_windows();
        if (!wins.length) return JSON.stringify({ ok: false, reason: "no-windows" });
        const pick = (cmp) => wins.reduce((b, x) => (cmp(x, b) ? x : b), wins[0]);
        let w = wins[0];
        if (hint === "leftmost") w = pick((x, b) => x.get_frame_rect().x < b.get_frame_rect().x);
        else if (hint === "rightmost")
          w = pick((x, b) => x.get_frame_rect().x > b.get_frame_rect().x);
        else if (hint === "topmost")
          w = pick((x, b) => x.get_frame_rect().y < b.get_frame_rect().y);
        else if (hint === "bottommost")
          w = pick((x, b) => x.get_frame_rect().y > b.get_frame_rect().y);
        if (op === "minimize") w.minimize();
        else if (op === "unminimize") w.unminimize();
        else if (op === "fullscreen") {
          if (!w.is_fullscreen()) w.make_fullscreen();
        } else if (op === "unfullscreen") {
          if (w.is_fullscreen()) w.unmake_fullscreen();
        } else if (op === "maximize") w.maximize(Meta.MaximizeFlags.BOTH);
        else if (op === "unmaximize") w.unmaximize(Meta.MaximizeFlags.BOTH);
        else return JSON.stringify({ ok: false, reason: "unknown-op:" + op });
        return JSON.stringify({ ok: true, op });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      }
    },

    // Simulate a drag-and-drop tile: drag the SRC window and drop it onto a ZONE of the TGT
    // window, exercising Forge's drop/reparent logic (moveWindowToPointer -> calculateDropRegions
    // /detectDropZone/_executeDropOperation) — the only path real keybindings can't reach
    // (forge-cnrc). opts: {src, tgt, zone}. Approach (robust + headless-deterministic): a real
    // pointer drag is flaky headless, so instead we (1) focus SRC (the grab handlers act on the
    // focused window), (2) _handleGrabOpBegin -> GRAB_TILE, (3) MONKEYPATCH wm.getPointer to
    // return a point inside the chosen drop ZONE of TGT (all drop math routes through getPointer
    // via getDragPointer), (4) call moveWindowToPointer directly (bypasses the held-modifier
    // allowDragDropTile gate — we want the reparent logic, not the gate), (5) restore + end grab.
    fuzzDrag(opts) {
      const o = opts || {};
      const wm = forgeExt() && forgeExt().extWm;
      if (!wm) return JSON.stringify({ ok: false, reason: "no-wm" });
      const origGetPointer = wm.getPointer;
      let origFocus = null;
      try {
        const wins = global.workspace_manager.get_active_workspace().list_windows();
        if (wins.length < 2) return JSON.stringify({ ok: false, reason: "need-2-windows" });
        const pick = (hint) => {
          if (hint === "leftmost")
            return wins.reduce(
              (b, x) => (x.get_frame_rect().x < b.get_frame_rect().x ? x : b),
              wins[0]
            );
          if (hint === "rightmost")
            return wins.reduce(
              (b, x) => (x.get_frame_rect().x > b.get_frame_rect().x ? x : b),
              wins[0]
            );
          if (hint === "topmost")
            return wins.reduce(
              (b, x) => (x.get_frame_rect().y < b.get_frame_rect().y ? x : b),
              wins[0]
            );
          if (hint === "bottommost")
            return wins.reduce(
              (b, x) => (x.get_frame_rect().y > b.get_frame_rect().y ? x : b),
              wins[0]
            );
          return wins[0];
        };
        const src = pick(o.src);
        let tgt = pick(o.tgt);
        if (tgt === src) tgt = wins.find((x) => x !== src) || src;
        if (tgt === src) return JSON.stringify({ ok: false, reason: "src==tgt" });

        // Drop point inside TGT for the requested zone (regions are computed at 0.3 inset).
        const tr = tgt.get_frame_rect();
        const fx = { center: 0.5, left: 0.12, right: 0.88, top: 0.5, bottom: 0.5 };
        const fy = { center: 0.5, left: 0.5, right: 0.5, top: 0.12, bottom: 0.88 };
        const zone = o.zone in fx ? o.zone : "center";
        const px = Math.round(tr.x + tr.width * fx[zone]);
        const py = Math.round(tr.y + tr.height * fy[zone]);

        const display = global.display;
        const grabOp = Meta.GrabOp.MOVING_UNCONSTRAINED;
        // Override focus to SRC for the whole grab (synchronous; src.focus() is async, so the
        // grab handlers — which act on focusMetaWindow — could otherwise grab the wrong window).
        // Mirrors invokeForgeAction's get_focus_window shim. Restored below / in catch.
        origFocus = display.get_focus_window;
        display.get_focus_window = function () {
          return src;
        };
        wm._handleGrabOpBegin(display, src, grabOp); // SRC -> GRAB_TILE, _draggedNodeWindow = src
        // Route the drop-ZONE math (calculateDropRegions/detectDropZone via getDragPointer) to the
        // chosen point inside TGT.
        wm.getPointer = function () {
          return [px, py, 0];
        };
        const dragged = wm._draggedNodeWindow || wm.findNodeWindow(src);
        // Drop target is deterministically TGT's node — we do NOT use _findNodeWindowAtPointer,
        // whose sortedWindows/isWindowAlive/getNodeByValue chain is built for a live pointer drag
        // and resolves null in this synthetic path. moveWindowToPointer just needs nodeWinAtPointer
        // + a GRAB_TILE dragged node + the (overridden) drag pointer for zone detection.
        wm.nodeWinAtPointer = wm.findNodeWindow(tgt);
        // Capture BEFORE _handleGrabOpEnd, which nulls nodeWinAtPointer (window.js:2997).
        const dropped = !!(dragged && wm.nodeWinAtPointer);
        if (dropped) wm.moveWindowToPointer(dragged);
        const dbg = { zone, draggedMode: dragged ? dragged.mode : null, tgtNode: dropped };
        wm.getPointer = origGetPointer;
        wm._handleGrabOpEnd(display, src, grabOp);
        display.get_focus_window = origFocus;
        return JSON.stringify({ ok: true, zone, dropped, dbg });
      } catch (e) {
        wm.getPointer = origGetPointer;
        if (origFocus) global.display.get_focus_window = origFocus;
        try {
          wm._handleGrabOpEnd(global.display, null, Meta.GrabOp.MOVING_UNCONSTRAINED);
        } catch (e2) {}
        return JSON.stringify({ ok: false, error: e.message });
      }
    },

    // Like fuzzDrag, but drives the REAL grab LOOP across multiple waypoints instead of just
    // the two endpoints (forge-v9o7). fuzzDrag jumps straight to the drop math; this one walks
    // src-center -> via-centers -> a zone of TGT, invoking _handleMoving at each point so the
    // preview-hint St.Bin lifecycle, the debounce path, and the live-preview branch
    // (moveWindowToPointer(...,true)) all run across positions. opts: {src, tgt, zone, vias:[hint,...]}.
    //
    // Monkeypatches, all restored in finally (mirrors fuzzDrag's gate-bypass philosophy):
    //  - get_focus_window -> SRC (grab handlers act on focusMetaWindow; src.focus() is async).
    //  - getPointer -> the current waypoint (patched AFTER begin so _grabStartPointer keeps the
    //    real pointer and getDragPointer returns each waypoint).
    //  - findNodeWindowAtPointer -> deterministic hit-test of the current waypoint against live
    //    windows (the real sortedWindows chain resolves null in this synthetic path; see fuzzDrag).
    //  - allowDragDropTile -> true, so the live-preview branch AND the real drop in
    //    _handleGrabOpEnd actually fire headless (no modifier is held).
    fuzzDragPath(opts) {
      const o = opts || {};
      const wm = forgeExt() && forgeExt().extWm;
      if (!wm) return JSON.stringify({ ok: false, reason: "no-wm" });
      const origGetPointer = wm.getPointer;
      const origFindAtPointer = wm.findNodeWindowAtPointer;
      const origAllow = wm.allowDragDropTile;
      let origFocus = null;
      let ended = false;
      try {
        const wins = global.workspace_manager.get_active_workspace().list_windows();
        if (wins.length < 2) return JSON.stringify({ ok: false, reason: "need-2-windows" });
        const pick = (hint) => {
          if (hint === "leftmost")
            return wins.reduce(
              (b, x) => (x.get_frame_rect().x < b.get_frame_rect().x ? x : b),
              wins[0]
            );
          if (hint === "rightmost")
            return wins.reduce(
              (b, x) => (x.get_frame_rect().x > b.get_frame_rect().x ? x : b),
              wins[0]
            );
          if (hint === "topmost")
            return wins.reduce(
              (b, x) => (x.get_frame_rect().y < b.get_frame_rect().y ? x : b),
              wins[0]
            );
          if (hint === "bottommost")
            return wins.reduce(
              (b, x) => (x.get_frame_rect().y > b.get_frame_rect().y ? x : b),
              wins[0]
            );
          return wins[0];
        };
        const src = pick(o.src);
        let tgt = pick(o.tgt);
        if (tgt === src) tgt = wins.find((x) => x !== src) || src;
        if (tgt === src) return JSON.stringify({ ok: false, reason: "src==tgt" });

        // Build the waypoint trail: src center -> each via window's center -> the TGT drop zone.
        const center = (w) => {
          const r = w.get_frame_rect();
          return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
        };
        const tr = tgt.get_frame_rect();
        const fx = { center: 0.5, left: 0.12, right: 0.88, top: 0.5, bottom: 0.5 };
        const fy = { center: 0.5, left: 0.5, right: 0.5, top: 0.12, bottom: 0.88 };
        const zone = o.zone in fx ? o.zone : "center";
        const waypoints = [center(src)];
        for (const v of o.vias || []) {
          const vw = pick(v);
          if (vw !== src) waypoints.push(center(vw));
        }
        waypoints.push([
          Math.round(tr.x + tr.width * fx[zone]),
          Math.round(tr.y + tr.height * fy[zone]),
        ]);

        const display = global.display;
        const grabOp = Meta.GrabOp.MOVING_UNCONSTRAINED;
        origFocus = display.get_focus_window;
        display.get_focus_window = function () {
          return src;
        };
        wm._handleGrabOpBegin(display, src, grabOp); // SRC -> GRAB_TILE; _grabStartPointer = real pointer
        const dragged = wm._draggedNodeWindow || wm.findNodeWindow(src);

        // Patch AFTER begin so _grabStartPointer kept the real pointer.
        let cur = [0, 0, 0];
        wm.getPointer = function () {
          return cur;
        };
        // Resolve the hover target at the CURRENT waypoint, hit-testing live windows (excl. SRC).
        wm.findNodeWindowAtPointer = function () {
          const px = cur[0];
          const py = cur[1];
          for (const w of wins) {
            if (w === src) continue;
            const r = w.get_frame_rect();
            if (px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height)
              return wm.findNodeWindow(w);
          }
          return null;
        };
        wm.allowDragDropTile = function () {
          return true;
        };

        const trail = [];
        for (const wp of waypoints) {
          cur = [wp[0], wp[1], 0];
          wm._handleMoving(dragged); // creates/uses previewHint + live-preview moveWindowToPointer
          trail.push({
            x: wp[0],
            y: wp[1],
            atPointer: !!wm.nodeWinAtPointer,
            hint: !!(dragged && dragged.previewHint),
          });
          try {
            wm.tree.render("e2e-fuzz-dragpath"); // synchronous render between moves (cf. fuzzRenderNow)
          } catch (e) {}
        }

        // Real drop happens HERE: _handleGrabOpEnd sees allowDragDropTile()===true and calls
        // moveWindowToPointer(focusNodeWindow) using the nodeWinAtPointer the last move resolved,
        // then _grabCleanup destroys the preview hint.
        wm._handleGrabOpEnd(display, src, grabOp);
        ended = true;
        return JSON.stringify({ ok: true, zone, waypoints: waypoints.length, trail });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.message });
      } finally {
        wm.getPointer = origGetPointer;
        wm.findNodeWindowAtPointer = origFindAtPointer;
        wm.allowDragDropTile = origAllow;
        if (origFocus) global.display.get_focus_window = origFocus;
        if (!ended) {
          // Half-open grab (we threw before the normal end): defensively release it so no window
          // is stranded in GRAB_TILE and no preview hint leaks. Mirror fuzzDrag's catch path.
          try {
            wm._handleGrabOpEnd(global.display, null, Meta.GrabOp.MOVING_UNCONSTRAINED);
          } catch (e2) {}
        }
      }
    },

    // Activate (switch to) a workspace by index, creating intermediate workspaces if needed, for
    // the fuzzer's workspace-switch chaos. Distinct from moveWindowToWorkspace (which moves the
    // focused window); this only changes the active workspace.
    activateWorkspace(wsIndex) {
      try {
        const wm = global.workspace_manager;
        const want = Math.max(0, wsIndex | 0);
        while (wm.get_n_workspaces() <= want)
          wm.append_new_workspace(false, global.get_current_time());
        const ws = wm.get_workspace_by_index(want);
        if (!ws) return JSON.stringify({ error: "workspace " + want + " unavailable" });
        ws.activate(global.get_current_time());
        return JSON.stringify({ ok: true, active: wm.get_active_workspace_index() });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },

    // firstMatch by class + reduceTree descendant count — was get_container_children_count
    // (shell_proxy.py:1451). countDescendants(parent) = nodes in parent's subtree, excluding
    // parent itself; reduceTree counts parent + descendants, so subtract 1.
    getContainerChildrenCount(wmClass) {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const windowNode = firstMatch(r, (n) => isWindowOfClass(n, wmClass));
        if (!windowNode || !windowNode.parentNode)
          return JSON.stringify({ error: "Window or parent not found" });
        const parent = windowNode.parentNode;
        const totalDescendants = reduceTree(parent, (acc) => ({ acc: acc + 1 }), 0) - 1;
        return JSON.stringify({
          directChildren: parent.childNodes.length,
          totalDescendants: totalDescendants,
          parentLayout: parent.layout,
          parentNodeType: parent.nodeType,
        });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },
    // === Non-tree query + action methods (widen). Use global.*/forgeExt()/Meta, not the
    // tree. Each byte-identical to its old inline body, including the absence of a try/catch
    // where the original had none. ===

    // was is_forge_enabled (returns the raw extension's state, not stateObj)
    isForgeEnabled() {
      try {
        const ext = Main.extensionManager.lookup(FORGE_UUID);
        return ext && ext.state === 1;
      } catch (e) {
        return false;
      }
    },

    // was get_focused_window (auto-activates first window if none focused; no try/catch)
    getFocusedWindow() {
      let focusWindow = global.display.get_focus_window();
      if (!focusWindow) {
        const ws = global.workspace_manager.get_active_workspace();
        const windows = ws.list_windows();
        if (windows.length > 0) {
          windows[0].activate(global.get_current_time());
          focusWindow = windows[0];
        }
      }
      if (!focusWindow) return JSON.stringify({ error: "No focused window" });
      return JSON.stringify({
        id: focusWindow.get_id(),
        title: focusWindow.get_title(),
        wmClass: focusWindow.get_wm_class(),
        rect: rect(focusWindow.get_frame_rect()),
      });
    },

    // was get_windows (no try/catch)
    getWindows() {
      const workspace = global.workspace_manager.get_active_workspace();
      const windows = workspace.list_windows();
      return JSON.stringify(
        windows.map((w) => ({
          title: w.get_title(),
          wmClass: w.get_wm_class(),
          rect: rect(w.get_frame_rect()),
          isFocused: w.has_focus(),
        }))
      );
    },

    // was get_workspace_rect (no try/catch)
    getWorkspaceRect() {
      const workspace = global.workspace_manager.get_active_workspace();
      const monitor = global.display.get_primary_monitor();
      return JSON.stringify(rect(workspace.get_work_area_for_monitor(monitor)));
    },

    // was count_windows_of_class (workspace list_windows, NOT the tree)
    countWindowsOfClass(wmClass) {
      try {
        const ws = global.workspace_manager.get_active_workspace();
        const wins = ws.list_windows();
        let n = 0;
        for (const w of wins) {
          if (w.get_wm_class() === wmClass) n++;
        }
        return String(n);
      } catch (e) {
        return "-1";
      }
    },

    // was get_monitor_count
    getMonitorCount() {
      try {
        return String(global.display.get_n_monitors());
      } catch (e) {
        return "-1";
      }
    },

    // was move_focused_window_to_monitor
    moveFocusedWindowToMonitor(monitorIndex) {
      try {
        const w = global.display.get_focus_window();
        if (!w) return "NO_FOCUS";
        // Mutter's move_to_monitor ABORTS the process on an out-of-range index (libmutter
        // meta_monitor_manager_get_logical_monitor_from_number assertion, GNOME 49.6) — an
        // uncatchable C-level abort, NOT a JS-catchable clamp. Reject out-of-range here so a
        // fuzzer rehome (or a replayed repro carrying a stale index) hits this guard instead
        // of crashing the shell. Valid indices behave exactly as before.
        const n = global.display.get_n_monitors();
        if (monitorIndex < 0 || monitorIndex >= n) return "OUT_OF_RANGE";
        w.move_to_monitor(monitorIndex);
        return "ok";
      } catch (e) {
        return "ERR " + e;
      }
    },

    // was count_maximized_windows (Mutter ground truth; is_maximized() on 49+, else
    // get_maximized() === Meta.MaximizeFlags.BOTH)
    countMaximizedWindows() {
      try {
        const ws = global.workspace_manager.get_active_workspace();
        let n = 0;
        for (const w of ws.list_windows()) {
          const maxed =
            typeof w.is_maximized === "function"
              ? w.is_maximized()
              : w.get_maximized() === Meta.MaximizeFlags.BOTH;
          if (maxed) n++;
        }
        return String(n);
      } catch (e) {
        return "-1";
      }
    },

    // was get_config_dir
    getConfigDir() {
      try {
        const ext = forgeExt();
        if (!ext || !ext.configMgr) return "";
        return ext.configMgr.confDir;
      } catch (e) {
        return "";
      }
    },

    // forge-9sd (Bug #312): drive the theme manager's persistence path so a test can
    // verify a color change is written to the on-disk stylesheet even when it is read-only.
    setThemeColor(selector, propertyName, value) {
      try {
        const ext = forgeExt();
        if (!ext || !ext.theme) return "no-theme";
        return ext.theme.setCssProperty(selector, propertyName, value) ? "ok" : "noop";
      } catch (e) {
        return "error:" + e;
      }
    },

    // was get_wm_override_classes (extWm.windowProps cached overrides)
    getWmOverrideClasses() {
      try {
        const ext = forgeExt();
        if (!ext || !ext.extWm) return "[]";
        const wp = ext.extWm.windowProps;
        const ov = wp && wp.overrides ? wp.overrides : [];
        return JSON.stringify(ov.map((o) => o.wmClass));
      } catch (e) {
        return "[]";
      }
    },

    // was get_float_overrides (configMgr.windowProps, re-parsed each access)
    getFloatOverrides() {
      try {
        const ext = forgeExt();
        if (!ext || !ext.configMgr) return "[]";
        const props = ext.configMgr.windowProps;
        const overrides = props && props.overrides ? props.overrides : [];
        return JSON.stringify(overrides);
      } catch (e) {
        return "[]";
      }
    },

    // was remove_class_float_override (returns count removed)
    removeClassFloatOverride(wmClass) {
      try {
        const ext = forgeExt();
        if (!ext || !ext.configMgr) return "0";
        const cfg = ext.configMgr;
        const props = cfg.windowProps;
        const all = props && props.overrides ? props.overrides : [];
        const before = all.length;
        props.overrides = all.filter(
          (o) => !(o.wmClass === wmClass && !o.wmId && !o.wmTitle && o.mode === "float")
        );
        cfg.windowProps = props;
        return String(before - props.overrides.length);
      } catch (e) {
        return "0";
      }
    },

    // was close_all_windows (returns the count closed as a number; no try/catch)
    closeAllWindows() {
      const ws = global.workspace_manager.get_active_workspace();
      const windows = ws.list_windows();
      const count = windows.length;
      windows.forEach((w) => {
        // forge-191a: round-trip for a valid server timestamp. global.get_current_time()
        // returns CurrentTime (0) when there is no event being processed — and inside a
        // Shell.Eval there never is — so delete(0) made every meta_window_check_alive ping
        // fail with "bad serial", escalating to a freed-window SIGSEGV under event load.
        w.delete(global.display.get_current_time_roundtrip());
      });
      return count;
    },

    // was close_one_window (returns remaining count; no try/catch)
    closeOneWindow() {
      const ws = global.workspace_manager.get_active_workspace();
      const windows = ws.list_windows();
      if (windows.length === 0) return "0";
      // forge-191a: valid server timestamp (not CurrentTime/0); see closeAllWindows.
      windows[0].delete(global.display.get_current_time_roundtrip());
      return String(windows.length - 1);
    },

    // Close the FOCUSED window via Mutter's delete() (reliable across versions,
    // unlike a synthetic alt+F4 which Clutter VirtualInputDevice fails to deliver
    // on older Mutter). Returns the closed window's id, or "no_focus".
    closeFocusedWindow() {
      const w = global.display.get_focus_window();
      if (!w) return "no_focus";
      const id = String(w.get_id());
      // forge-191a: valid server timestamp (not CurrentTime/0); see closeAllWindows.
      w.delete(global.display.get_current_time_roundtrip());
      return id;
    },

    // was ensure_focus (no try/catch)
    ensureFocus() {
      if (global.display.get_focus_window()) return "already_focused";
      const ws = global.workspace_manager.get_active_workspace();
      const windows = ws.list_windows();
      if (windows.length === 0) return "no_windows";
      windows[0].activate(global.get_current_time());
      return "activated";
    },

    // was invoke_forge_action — ext.extWm.command(action) with a temporary focus override
    // (and optional genuine focus). action is a plain object; focusHint is a string or null;
    // alsoActivate is a bool. See shell_proxy.invoke_forge_action for the forge-2n0 rationale.
    invokeForgeAction(action, focusHint, alsoActivate) {
      try {
        const ext = forgeExt();
        if (!ext) return "Error: Forge not loaded";
        if (!ext.extWm) return "Error: extWm not available";

        const ws = global.workspace_manager.get_active_workspace();
        const wins = ws.list_windows();
        const origFn = global.display.get_focus_window;
        let focusMethod = "natural";
        const hint = focusHint;

        if ((hint || !origFn.call(global.display)) && wins.length > 0) {
          let targetWin = wins[0];
          if (hint === "leftmost") {
            targetWin = wins.reduce(
              (best, w) => (w.get_frame_rect().x < best.get_frame_rect().x ? w : best),
              wins[0]
            );
          } else if (hint === "rightmost") {
            targetWin = wins.reduce(
              (best, w) => (w.get_frame_rect().x > best.get_frame_rect().x ? w : best),
              wins[0]
            );
          } else if (hint === "topmost") {
            targetWin = wins.reduce(
              (best, w) => (w.get_frame_rect().y < best.get_frame_rect().y ? w : best),
              wins[0]
            );
          } else if (hint === "bottommost") {
            targetWin = wins.reduce(
              (best, w) => (w.get_frame_rect().y > best.get_frame_rect().y ? w : best),
              wins[0]
            );
          }
          global.display.get_focus_window = function () {
            return targetWin;
          };
          focusMethod = hint ? "hint_override" : "display_override";
          if (alsoActivate) {
            try {
              targetWin.focus(global.get_current_time());
            } catch (e) {}
          }
        }

        try {
          ext.extWm.command(action);
          return "OK_" + focusMethod;
        } finally {
          global.display.get_focus_window = origFn;
        }
      } catch (e) {
        return "Error: " + e.message;
      }
    },

    // was move_window_to_workspace (creates the target workspace if needed)
    moveWindowToWorkspace(wsIndex) {
      try {
        const wsMgr = global.workspace_manager;
        const ws = wsMgr.get_active_workspace();
        const windows = ws.list_windows();
        if (windows.length === 0) return "No windows";
        while (wsMgr.get_n_workspaces() <= wsIndex) {
          wsMgr.append_new_workspace(false, global.get_current_time());
        }
        windows[0].change_workspace_by_index(wsIndex, false);
        return "OK";
      } catch (e) {
        return "Error: " + e.message;
      }
    },

    // was get_active_workspace_index (no try/catch)
    getActiveWorkspaceIndex() {
      return String(global.workspace_manager.get_active_workspace_index());
    },

    // was get_workspace_count (no try/catch)
    getWorkspaceCount() {
      return String(global.workspace_manager.get_n_workspaces());
    },

    // was is_workspace_tiling_skipped (reads the 'workspace-skip-tile' setting CSV)
    isWorkspaceTilingSkipped(wsIndex) {
      try {
        const ext = forgeExt();
        if (!ext) return "false";
        const skipStr = ext.settings.get_string("workspace-skip-tile");
        if (!skipStr) return "false";
        const indices = skipStr.split(",");
        for (let i = 0; i < indices.length; i++) {
          if (indices[i].trim() === String(wsIndex)) return "true";
        }
        return "false";
      } catch (e) {
        return "false";
      }
    },

    // --- Virtual input + overlay (folded in from shell_proxy.py, forge-9q3) --------------------
    // These were three separate globalThis injections (devices, overlay) parallel to this
    // bridge. They now ride the SAME inject-once bridge install. Both are LAZY and idempotent:
    // creation happens on first use (NOT at install), so the universally-run install can't be
    // broken by a not-yet-ready Clutter seat, and the dbus-only lanes never create them. The
    // thin Python callers (simulate_*, _render_overlay) invoke these.

    // Create + cache the Clutter virtual keyboard/pointer in globalThis (once). The per-press
    // notify_* sequences are still built in Python (they vary per call); this only owns device
    // creation. Wrapped so a seat that isn't ready returns a sentinel instead of throwing.
    ensureVirtualDevices() {
      try {
        const seat = Clutter.get_default_backend().get_default_seat();
        if (!globalThis._forgeTestVKbd) {
          globalThis._forgeTestVKbd = seat.create_virtual_device(
            Clutter.InputDeviceType.KEYBOARD_DEVICE
          );
        }
        if (!globalThis._forgeTestVMouse) {
          globalThis._forgeTestVMouse = seat.create_virtual_device(
            Clutter.InputDeviceType.POINTER_DEVICE
          );
        }
        return "ok";
      } catch (e) {
        return "ERROR: " + e;
      }
    },

    // reduceTree — forge-63y (gh-529): drag-preview hint leak detector. The hint is an
    // anonymous St.Bin cached on the WINDOW node (window.js previewHint, no type marker on
    // the actor), created during a drag and released in _grabCleanup/_handleGrabOpEnd. Any
    // node still holding one outside an active grab is a leak; `visible` is the stuck-red-
    // overlay shape the reporter saw.
    getPreviewHintState() {
      try {
        const r = root();
        if (!r) return JSON.stringify({ error: "Tree not available" });
        const state = reduceTree(
          r,
          (acc, n) => {
            if (n.previewHint) {
              acc.count += 1;
              if (n.previewHint.visible) acc.visible += 1;
            }
            return { acc };
          },
          { count: 0, visible: 0 }
        );
        return JSON.stringify(state);
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },

    // Focus-correctness probe (Angle 3). The original spec (focusMetaWindow vs
    // get_focus_window) was a tautology — focusMetaWindow IS get_focus_window (window.js:951).
    // Instead: after the tree settles, Mutter's focused window must be the tree's "active/
    // visible child" of its STACKED parent, i.e. the restack updateStackedFocus (focus.js:111)
    // is supposed to perform on every focus — it appendChild()s the focused node to LAST and
    // raises the stack in order. A divergence is the forge-d5mm class (click/alt-tab focus
    // failing to re-stack a STACKED container).
    //
    // ONLY the STACKED case is asserted, deliberately: it is a PURELY STRUCTURAL tree fact
    // (child order), unperturbed by Wayland stacking. A TABBED variant via Mutter's
    // sort_windows_by_stacking was prototyped and FALSE-POSITIVED on clean runs (focus-raise
    // races the settle, and transient _forgeTransientAbove make_above pins leave another window
    // on top) — a noisy focus oracle is worse than none, so it was dropped.
    //
    // CONSERVATIVE: a transient/ambiguous state is NON-violating — null focus (between windows),
    // a window mid-close, a focused window not yet in the tree (fresh spawn / dialog), or a
    // parent with < 2 tiled children. We only ever assert a positive structural fact.
    // Re-readable (flows through check_with_retry's transient guard).
    // Returns {violations:[{rule,detail,path}]}.
    fuzzFocusMismatch() {
      try {
        const r = root();
        if (!r) return JSON.stringify({ violations: [] });
        const fw = global.display.get_focus_window();
        if (!fw) return JSON.stringify({ violations: [] }); // transient null focus
        let alive = false;
        try {
          alive = typeof fw.get_id === "function" && fw.get_id() != null;
        } catch (e) {
          alive = false;
        }
        if (!alive) return JSON.stringify({ violations: [] }); // window mid-close
        const node = firstMatch(r, (n) => n.nodeValue === fw);
        if (!node || !node.parentNode) return JSON.stringify({ violations: [] }); // untracked yet
        const parent = node.parentNode;
        // Only assert the stacked-container invariant on a real CON: a MONITOR/WORKSPACE node
        // may legitimately carry a STACKED layout (flat trees with AUTOSPLIT off), and is out
        // of scope here. nodeType is a string enum (cf. n.nodeType === "WINDOW" above).
        if (parent.nodeType !== "CON" || parent.layout !== "STACKED")
          return JSON.stringify({ violations: [] });
        let tiled;
        try {
          tiled = r.getTiledChildren(parent.childNodes);
        } catch (e) {
          tiled = [];
        }
        // node must be a tiled child of this STACKED parent, and order only matters with >= 2.
        if (tiled.indexOf(node) < 0 || tiled.length < 2) {
          return JSON.stringify({ violations: [] });
        }
        const violations = [];
        // updateStackedFocus appendChild()s the focused node to LAST and raises in order, so
        // after settle the focused node must be the last (top-of-stack) tiled child.
        if (tiled[tiled.length - 1] !== node) {
          violations.push({
            rule: "focus-mismatch",
            detail: "focused window is not the top (last) child of its STACKED container",
            path: "stacked",
          });
        }
        return JSON.stringify({ violations });
      } catch (e) {
        // Never let the probe itself fail a session — a thrown probe is not a Forge bug.
        return JSON.stringify({ violations: [] });
      }
    },

    // Resource-leak METRIC (Angle 3, demoted to a logged metric — exact-baseline-after-disable
    // is flaky from GJS GC timing). Consolidates the ALREADY-tracked collections scattered across
    // WindowManager + the tree into one cheap snapshot the engine logs / non-growth-warns on:
    //  - signals: total length of the bound-once global signal arrays (_displaySignals,
    //    _windowManagerSignals, _workspaceManagerSignals, _settingsSignals, _overviewSignals).
    //    These are bound once in _bindSignals and never grow — so growth here is a real leak.
    //  - timers: count of LIVE tracked GLib source ids (the set _removeSignals clears). Transient
    //    by nature (come and go), reported for visibility, NOT a non-growth target.
    //  - decorations/tabs/previewHints: per-node actors counted by walking the tree (Node.tab /
    //    Node.decoration / Node.previewHint, tree.js:85-86). Scale with tabbed/stacked containers
    //    and windows, so reported but NOT a steady-state non-growth target.
    fuzzResourceCounts() {
      try {
        const ext = forgeExt();
        const wm = ext && ext.extWm;
        if (!wm) return JSON.stringify({ error: "no-wm" });
        const arrLen = (a) => (Array.isArray(a) ? a.length : 0);
        const signals =
          arrLen(wm._displaySignals) +
          arrLen(wm._windowManagerSignals) +
          arrLen(wm._workspaceManagerSignals) +
          arrLen(wm._settingsSignals) +
          arrLen(wm._overviewSignals);
        const timerIds = [
          "_renderTreeSrcId",
          "_reloadTreeSrcId",
          "_wsWindowAddSrcId",
          "_windowHomeReconcileSrcId",
          "_queueSourceId",
          "_manualResizeEndId",
          "_pointerFocusTimeoutId",
          "_workspaceChangingTimeoutId",
        ];
        let timers = 0;
        for (const id of timerIds) if (wm[id]) timers += 1;
        let decorations = 0;
        let tabs = 0;
        let previewHints = 0;
        const r = root();
        if (r) {
          reduceTree(
            r,
            (acc, n) => {
              if (n.decoration) decorations += 1;
              if (n.tab) tabs += 1;
              if (n.previewHint) previewHints += 1;
              return { acc };
            },
            null
          );
        }
        return JSON.stringify({ signals, timers, decorations, tabs, previewHints });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },

    // Render the screencast overlay label (forge-eyu): create-if-needed + set text + position +
    // raise + show. Cached on globalThis._forgeTestOverlay so it survives across evals. Parented
    // to uiGroup — NOT addChrome, which would register struts and perturb tiling geometry. Text
    // composition (test name + firing action) stays in the Python caller.
    renderOverlay(text) {
      let o = globalThis._forgeTestOverlay;
      if (!o) {
        o = new St.Label({
          style_class: "forge-e2e-overlay",
          style:
            "background-color:rgba(0,0,0,0.72);color:#ffffff;font-size:20px;" +
            "font-family:monospace;padding:8px 14px;border-radius:8px;",
        });
        o.clutter_text.set_line_wrap(false);
        Main.layoutManager.uiGroup.add_child(o);
        globalThis._forgeTestOverlay = o;
      }
      o.text = text;
      const pm = Main.layoutManager.primaryMonitor;
      o.set_position(pm.x + 20, pm.y + 20);
      Main.layoutManager.uiGroup.set_child_above_sibling(o, null);
      o.show();
      return "ok";
    },
  };

  return "ok";
})();
