"""Shared Forge-tree queries for nested-container (Bug #57 / forge-37r) tests."""

# Focus the WINDOW sibling of a nested CON, so a following stacked/tabbed
# toggle targets the parent container that holds both. Returns 'activated'
# on success.
FOCUS_WINDOW_SIBLING_OF_CON = """
(() => {
  const ext = Main.extensionManager.lookup('forge@jmmaranan.com').stateObj;
  const tree = ext && ext.extWm && ext.extWm.tree;
  if (!tree) return 'no-tree';
  let target = null;
  const walk = (n) => {
    if (!n || target) return;
    const kids = n.childNodes || [];
    if (n.nodeType === 'CON' &&
        kids.some(c => c.nodeType === 'CON') &&
        kids.some(c => c.nodeType === 'WINDOW')) {
      target = kids.find(c => c.nodeType === 'WINDOW');
      return;
    }
    kids.forEach(walk);
  };
  walk(tree);
  if (target && target.nodeValue) {
    target.nodeValue.activate(global.get_current_time());
    return 'activated';
  }
  return 'no-target';
})()
"""


def con_child_window_counts(shell_proxy, layout):
    """Per CON child of any node with the given layout, count WINDOW descendants.

    A nested split preserved as one stack/tab item (Bug #57) appears as a CON
    child of the STACKED/TABBED node; flattening would instead put those windows
    directly under it, leaving it with no CON child.
    """

    def count_windows(node):
        if not isinstance(node, dict):
            return 0
        n = 1 if node.get("nodeType") == "WINDOW" else 0
        for c in node.get("children") or []:
            n += count_windows(c)
        return n

    counts = []

    def walk(node):
        if not isinstance(node, dict):
            return
        children = node.get("children") or []
        if node.get("layout") == layout:
            for c in children:
                if c.get("nodeType") == "CON":
                    counts.append(count_windows(c))
        for c in children:
            walk(c)

    walk(shell_proxy.get_forge_tree())
    return counts
