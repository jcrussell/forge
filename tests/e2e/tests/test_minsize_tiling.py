"""
Minimum-size-aware tiling (forge-s6g / forge-kvao).

forge-s6g made Tree.computeSizes() honor window minimum sizes by redistributing
tile space (i3-style): a window whose minimum exceeds its percentage slice is
floored at its minimum and its slack-bearing siblings shrink, so a large-min
window never overlaps its neighbour.

No headless app reliably reports a large minimum width, so this drives the
behavior deterministically: a bridge helper shadows get_min_size() on the
leftmost tiled window with a minimum wider than its 50% share, then re-renders.
We then assert from the rendered frames that the constrained window grew past
its equal share AND that the two windows do not overlap.
"""

import pytest
from framework.constants import Tolerance
from framework.wait import wait_for_window_count


class TestMinSizeTiling:
    """End-to-end coverage for minimum-size-aware tiling."""

    def test_minwidth_window_honored_without_overlap(self, shell_proxy, window_helper, two_windows):
        """A window with a min-width wider than its slice keeps its minimum and
        does not overlap its neighbour."""
        # Before GNOME 50 Mutter exposes no minimum size, so Forge tiles by percent
        # alone (docs/dev/compat.md); the real-window test below checks that.
        if shell_proxy.get_shell_major_version() < 50:
            pytest.skip("requires GNOME 50+ (Meta.Window.get_min_size)")
        wait_for_window_count(shell_proxy, 2)

        workspace = window_helper.get_workspace_rect()
        ws_width = workspace["width"]
        half = ws_width // 2

        # A minimum noticeably wider than the equal 50% share, but still leaving
        # room for the sibling (70% of the workspace).
        min_width = int(ws_width * 0.7)

        windows = shell_proxy.get_windows()
        wm_class = windows[0].get("wmClass")
        assert wm_class, "test windows should report a wmClass"

        try:
            result = shell_proxy.eval(
                "globalThis._forgeTestBridge.setLeftmostWindowMinSize('%s', %d, 0)"
                % (wm_class, min_width)
            )
            assert isinstance(result, dict) and result.get("ok"), (
                f"setLeftmostWindowMinSize failed: {result!r}"
            )
            # get_min_size() is a client size, which for a CSD window includes its
            # shadows; Forge honors it as the matching frame size.
            min_frame_width = min_width + result["frameExtents"]["width"]

            # renderTree is async (GLib.idle_add); wait for the render to settle
            # before measuring the rendered frames.
            shell_proxy.wait_for_idle()

            sorted_windows = sorted(
                shell_proxy.get_windows(), key=lambda w: w.get("rect", {}).get("x", 0)
            )
            assert len(sorted_windows) >= 2, "expected two tiled windows"
            left = sorted_windows[0]["rect"]
            right = sorted_windows[1]["rect"]

            # The constrained window kept (approximately) its minimum width...
            assert left["width"] >= min_frame_width - Tolerance.SIZE, (
                f"constrained window width {left['width']} should be ~>= min frame "
                f"width {min_frame_width} (client min {min_width})"
            )
            # ...which is more than the equal split it would have gotten otherwise.
            assert left["width"] > half, (
                f"constrained window {left['width']} should exceed its equal share {half}"
            )
            # And the two windows must not overlap.
            left_end = left["x"] + left["width"]
            assert left_end <= right["x"] + Tolerance.OVERLAP, (
                f"windows overlap: left ends at {left_end}, right starts at {right['x']}"
            )
        finally:
            shell_proxy.eval("globalThis._forgeTestBridge.resetWindowMinSize('%s')" % wm_class)
            shell_proxy.wait_for_idle()

    def test_real_window_reports_min_size(self, shell_proxy, two_windows):
        """Compat.getMinFrameSize reads Meta.Window.get_min_size() from Mutter 50,
        which the unit mocks and the bridge above shadow, so check the real API on
        every lane: present and sane from 50; before 50 there is no minimum-size
        API at all (neither get_min_size nor the get_size_hints Forge used to call),
        so minimum-size-aware tiling is off there, as it always was."""
        wait_for_window_count(shell_proxy, 2)
        major = shell_proxy.get_shell_major_version()

        result = shell_proxy.eval(
            """JSON.stringify((() => {
                const w = global.get_window_actors()
                    .map((a) => a.meta_window)
                    .find((m) => m.get_window_type() === 0);
                if (!w) return { error: "no normal window" };
                const api = {
                    getMinSize: typeof w.get_min_size === "function",
                    getSizeHints: typeof w.get_size_hints === "function",
                };
                if (!api.getMinSize) return api;
                const [hasMin, minWidth, minHeight] = w.get_min_size();
                return { ...api, hasMin, minWidth, minHeight };
            })())"""
        )

        assert isinstance(result, dict), f"unexpected eval result {result!r}"
        assert "error" not in result, result["error"]
        if major >= 50:
            assert result["getMinSize"], f"GNOME {major}: Meta.Window.get_min_size() is missing"
            assert isinstance(result["hasMin"], bool)
            assert result["minWidth"] >= 0 and result["minHeight"] >= 0, result
        else:
            assert not result["getMinSize"], (
                f"GNOME {major} has get_min_size(): move Compat.getMinFrameSize's cutoff down"
            )
            assert not result["getSizeHints"], (
                f"GNOME {major} has get_size_hints(): reading the minimum through it worked "
                "here, so get_min_size-only is a regression on this version"
            )
