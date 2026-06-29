"""Smoke test for the fuzzer's drag-drop tile primitive (bridge.fuzzDrag / forge-cnrc).

Confirms the simulated drag actually drives Forge's drop/reparent logic (not a silent
no-op): drag the leftmost window onto the CENTER of the rightmost window and assert a
STACKED/TABBED container appears (a center-drop nests the two windows into one). Not part
of the fuzz lane — a plain e2e check; run with `-k drag_smoke`.
"""

import time


def _has_layout(node, layouts):
    if not isinstance(node, dict):
        return False
    if node.get("layout") in layouts:
        return True
    return any(_has_layout(c, layouts) for c in (node.get("children") or []))


def test_drag_smoke(shell_proxy, three_windows):
    before = shell_proxy.get_forge_tree()
    # Three freshly-tiled windows split horizontally — no stacked/tabbed container yet.
    assert not _has_layout(before, {"STACKED", "TABBED"}), "unexpected stacked/tabbed pre-drag"

    res = shell_proxy.fuzz_drag("leftmost", "rightmost", "center")
    time.sleep(1.0)
    after = shell_proxy.get_forge_tree()

    print("DRAG_RESULT=%s" % (res,))
    assert isinstance(res, dict) and res.get("ok"), "fuzzDrag failed: %s" % (res,)
    assert res.get("dropped"), "fuzzDrag found no drop target: %s" % (res,)
    # A center-drop nests src+tgt into a STACKED or TABBED CON — its appearance proves the
    # drop/reparent executed (vs a no-op; node count alone is unreliable — the grab cycle
    # perturbs it regardless).
    assert _has_layout(after, {"STACKED", "TABBED"}), (
        "no stacked/tabbed container after center-drop — reparent did not execute"
    )
