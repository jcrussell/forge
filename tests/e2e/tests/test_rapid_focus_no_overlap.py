"""forge-ph7f: a fast focus-navigation burst must not un-tile windows.

On Wayland, Tree.focus() briefly pins the focused window make_above() and used a
single shared 50ms timer to unpin it. Focusing faster than 50ms cancelled the
previous window's pending unpin, stranding earlier windows always-on-top, which
isFloatingExempt then float-ejected so they overlapped. The fix keys the unpin
timer per-window and flags Forge's transient pin so isFloatingExempt skips it.

This drives a rapid focus burst through extWm.command and asserts that, once the
50ms timers have settled, no window is left always-on-top and the windows are
still tiled (no overlap).
"""

import json
import time

# Fire a rapid alternating focus burst (faster than the 50ms unpin), then report
# how many windows are left always-on-top immediately after.
BURST_JS = r"""
(() => {
  const ext = Main.extensionManager.lookup('forge@jmmaranan.com').stateObj;
  const wm = ext && ext.extWm;
  if (!wm) return JSON.stringify({err: 'no-wm'});
  for (let i = 0; i < 10; i++) {
    wm.command({name: 'Focus', direction: (i % 2 ? 'Left' : 'Right')});
  }
  const wins = wm.tree.nodeWindows.filter((n) => n.nodeValue).map((n) => n.nodeValue);
  return JSON.stringify({
    total: wins.length,
    immediateAbove: wins.filter((w) => w.is_above()).length,
  });
})()
"""

# After the timers settle: no window should remain above, and we report rects.
SETTLE_JS = r"""
(() => {
  const ext = Main.extensionManager.lookup('forge@jmmaranan.com').stateObj;
  const wm = ext && ext.extWm;
  if (!wm) return JSON.stringify({err: 'no-wm'});
  const wins = wm.tree.nodeWindows.filter((n) => n.nodeValue).map((n) => n.nodeValue);
  const rects = wins.map((w) => { const r = w.get_frame_rect(); return [r.x, r.y, r.width, r.height]; });
  return JSON.stringify({
    settledAbove: wins.filter((w) => w.is_above()).length,
    rects: rects,
  });
})()
"""


def _overlap(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ox = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    oy = max(0, min(ay + ah, by + bh) - max(ay, by))
    return ox * oy


def test_rapid_focus_keeps_windows_tiled(shell_proxy, three_windows):
    burst = shell_proxy.eval(BURST_JS)
    assert isinstance(burst, dict) and "err" not in burst, f"burst failed: {burst!r}"
    print("\nburst:", json.dumps(burst))

    # Let the per-window 50ms unpin timers fire.
    time.sleep(0.4)

    settled = shell_proxy.eval(SETTLE_JS)
    assert isinstance(settled, dict) and "err" not in settled, f"settle failed: {settled!r}"
    print("settled:", json.dumps(settled))

    # The bug left earlier windows stranded always-on-top after the burst.
    assert settled["settledAbove"] == 0, f"windows stuck above: {settled['settledAbove']}"

    # Stranded-above windows were float-ejected and overlapped. Tiled windows
    # must not significantly overlap each other.
    rects = settled["rects"]
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            ov = _overlap(rects[i], rects[j])
            assert ov < 2000, f"windows {i},{j} overlap by {ov}px^2: {rects[i]} {rects[j]}"
