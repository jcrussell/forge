"""forge-36le: the yellow split-direction hint border must render for the
focused tiled window in a split.

The bug was a pure St rendering issue: showWindowBorders() correctly created a
visible, correctly-classed, correctly-positioned splitBorder St.Bin, but St does
not paint an asymmetric (single-side) border when a border-radius is set, so the
one-edge directional hint never appeared. The fix drops border-radius on the
.window-split-{horizontal,vertical} classes.

This guards the logic invariants the bin depends on (created, focused-visible,
correct directional class + asymmetric border widths). A headless container
cannot raster-capture to assert the painted pixels; the actor/theme-node state
below is the strongest deterministic signal available.
"""

import json

# Force a synchronous border-layout pass, then report the focused window's
# splitBorder actor + its St theme node's computed per-side border widths.
PROBE_JS = r"""
(() => {
  const ext = Main.extensionManager.lookup('forge@jmmaranan.com').stateObj;
  const wm = ext && ext.extWm;
  if (!wm) return JSON.stringify({err: 'no-wm'});
  try { wm.updateBorderLayout(); } catch (e) { return JSON.stringify({err: 'ublayout:' + e}); }
  const mw = wm.focusMetaWindow;
  if (!mw) return JSON.stringify({err: 'no-focus'});
  const actor = mw.get_compositor_private();
  const node = wm.findNodeWindow(mw);
  const parent = node && node.parentNode;
  const sb = actor && actor.splitBorder;
  const cls = (a) => a ? (a.get_style_class_name ? a.get_style_class_name() : a.style_class) : null;
  let borderW = null;
  try {
    // St.Side order: TOP=0, RIGHT=1, BOTTOM=2, LEFT=3.
    const tn = sb && sb.get_theme_node && sb.get_theme_node();
    if (tn) borderW = [0,1,2,3].map((s) => tn.get_border_width(s));
  } catch (e) { borderW = 'err:' + e; }
  return JSON.stringify({
    parentLayout: parent && parent.layout,
    appearsFocused: mw.appears_focused,
    hasSplitBorder: !!sb,
    splitClass: cls(sb),
    splitVisible: sb ? sb.visible : null,
    splitInGroup: sb ? global.window_group.contains(sb) : false,
    borderWidthsTRBL: borderW,
  });
})()
"""


def test_split_border_renders_for_focused_split_window(shell_proxy, two_windows):
    probe = shell_proxy.eval(PROBE_JS)
    print("\nsplit-border probe:", json.dumps(probe, indent=2))

    assert isinstance(probe, dict), f"probe failed: {probe!r}"
    assert "err" not in probe, f"probe error: {probe.get('err')}"

    # Two windows tile side-by-side under the monitor: a horizontal split.
    assert probe["parentLayout"] == "HSPLIT"
    assert probe["appearsFocused"] is True

    # The split-direction bin must exist, carry the directional class, be
    # parented in window_group, and be shown for the focused window.
    assert probe["hasSplitBorder"] is True
    assert "window-split-horizontal" in (probe["splitClass"] or "")
    assert probe["splitInGroup"] is True
    assert probe["splitVisible"] is True

    # The horizontal hint is a single right-edge border (T,R,B,L) = (0,3,0,0).
    # This is what St failed to paint while a border-radius was also set.
    assert probe["borderWidthsTRBL"] == [0, 3, 0, 0], probe["borderWidthsTRBL"]
