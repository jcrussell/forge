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
// eslint-env: this is GJS, not Node/browser. `Main`, `global`, `imports`, `globalThis` are
// gnome-shell Eval globals. See forge-mpt for adding a real GJS eslint env.
/* global Main, globalThis */

(function () {
  if (globalThis._forgeTestBridge) return "ok"; // idempotency belt-and-suspenders (Python flag is primary guard)

  const FORGE_UUID = "forge@jmmaranan.com";

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
        if (!r) return "0";
        const count = reduceTree(
          r,
          (acc, n) => (n.nodeType === "WINDOW" ? { acc: acc + 1, descend: false } : { acc }),
          0
        );
        return String(count);
      } catch (e) {
        return "0";
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
        if (!r) return "0";
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
  };

  return "ok";
})();
