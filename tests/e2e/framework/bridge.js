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
        w.delete(global.get_current_time());
      });
      return count;
    },

    // was close_one_window (returns remaining count; no try/catch)
    closeOneWindow() {
      const ws = global.workspace_manager.get_active_workspace();
      const windows = ws.list_windows();
      if (windows.length === 0) return "0";
      windows[0].delete(global.get_current_time());
      return String(windows.length - 1);
    },

    // Close the FOCUSED window via Mutter's delete() (reliable across versions,
    // unlike a synthetic alt+F4 which Clutter VirtualInputDevice fails to deliver
    // on older Mutter). Returns the closed window's id, or "no_focus".
    closeFocusedWindow() {
      const w = global.display.get_focus_window();
      if (!w) return "no_focus";
      const id = String(w.get_id());
      w.delete(global.get_current_time());
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
