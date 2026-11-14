"""
Regression Validation Tests for Forge.

These E2E tests validate that unit test mocks accurately reflect real GNOME Shell
behavior by porting regression tests and verifying the same outcomes occur in
both environments.

This serves as a proof of concept for:
1. Validating unit test mocks match real GNOME Shell behavior
2. Expanding test coverage with behaviors that mocks can't simulate
3. Catching regressions that might slip through mock-based tests
"""

import time

import pytest
from framework.constants import Timing, Tolerance
from framework.tree_queries import FOCUS_WINDOW_SIBLING_OF_CON, con_child_window_counts
from framework.wait import (
    wait_for_layout,
    wait_for_layout_settled,
    wait_for_stable,
    wait_for_window_count,
)
from framework.workflow import invoke_resize


class TestBug125VerticalStackedTiling:
    """
    Bug #125: Impossible to tile large windows vertically when in stacked mode.

    Problem: When dragging a window from a stacked/tabbed container, top/bottom
    drop zones add to the stack instead of creating a vertical split.

    This test validates that:
    - Windows can be placed in stacked layout
    - In stacked mode, windows occupy the same space (overlap)
    - Window dimensions change when entering stacked mode
    """

    @pytest.fixture(autouse=True)
    def _enable_stacked_tabbed_modes(self, restore_settings):
        """Stacked/tabbed modes default OFF in the gschema, so StackedLayoutToggle
        bails early (command.js) and toggle_stacked() is a silent no-op — which is
        why the wait_for_layout("STACKED") gates below time out without this. Enable
        the modes so the toggles actually exercise stacked layout; restore_settings
        reverts after each test and the settle lets the GSetting reach Forge first.
        """
        restore_settings.set_stacked_tiling_mode_enabled(True)
        restore_settings.set_tabbed_tiling_mode_enabled(True)

    def test_stacked_layout_changes_window_arrangement(
        self, shell_proxy, window_helper, input_sim, three_windows
    ):
        """Verify toggling to stacked changes window arrangement."""
        window1, window2, window3 = three_windows

        # Wait for initial tiling
        windows_before = wait_for_window_count(shell_proxy, 3)
        assert len(windows_before) >= 3, f"Expected 3 windows, got {len(windows_before)}"

        # Calculate total width of windows before stacking
        total_width_before = sum(w.get("rect", {}).get("width", 0) for w in windows_before)

        # Toggle layout to stacked (Shift+Super+s is default keybinding).
        # toggle_stacked() waits for the layout to land.
        input_sim.toggle_stacked()
        wait_for_layout(shell_proxy, "STACKED")  # confirm the toggle took effect

        # Get window positions after stacking
        windows_after = shell_proxy.get_windows()
        assert len(windows_after) >= 3, "Expected 3 windows after stacking"

        # In stacked mode, all windows should have similar (larger) width
        # because they all occupy the full container space
        widths_after = [w.get("rect", {}).get("width", 0) for w in windows_after]
        max_width_after = max(widths_after) if widths_after else 0

        # Each window in stacked mode should be larger than when split
        avg_width_before = total_width_before / 3
        assert max_width_after > avg_width_before, (
            f"Stacked window width ({max_width_after}) should be larger than "
            f"average split width ({avg_width_before:.0f})"
        )

    def test_stacked_windows_have_similar_dimensions(
        self, shell_proxy, window_helper, input_sim, three_windows
    ):
        """In stacked mode, windows should have similar dimensions."""
        window1, window2, window3 = three_windows

        wait_for_window_count(shell_proxy, 3)

        # Toggle to stacked layout (self-settles).
        input_sim.toggle_stacked()
        wait_for_layout(shell_proxy, "STACKED")  # confirm the toggle took effect

        # Get windows after stacking (three_windows guarantees 3, so assert
        # unconditionally rather than silently skipping on a failed toggle).
        windows_after = shell_proxy.get_windows()
        rects = [w.get("rect", {}) for w in windows_after]

        # In stacked mode, all windows should have similar dimensions
        widths = [r.get("width", 0) for r in rects if r]
        heights = [r.get("height", 0) for r in rects if r]

        # All widths should be similar (stacked windows share space)
        width_variance = max(widths) - min(widths)
        assert width_variance < 50, (
            f"Stacked windows should have similar width, variance: {width_variance}"
        )

        # All heights should be similar
        height_variance = max(heights) - min(heights)
        assert height_variance < 100, (
            f"Stacked windows should have similar height, variance: {height_variance}"
        )


class TestBug305Resize:
    """
    Bug #305: Resizing one boundary also moves opposite boundary.

    Problem: When resizing one side of a window boundary, the opposite side
    also moves instead of staying in place.

    This test validates that:
    - Window resize operations affect only adjacent windows
    - Windows maintain valid proportions after tiling
    - Non-adjacent siblings maintain their original size
    """

    def test_two_window_resize_proportions(self, shell_proxy, window_helper, two_windows):
        """Resizing the shared boundary moves only that boundary: the left window grows
        by what the right one loses, and the outer edges stay put."""
        workspace = window_helper.get_workspace_rect()
        left, right = (w["rect"] for w in window_helper.get_windows_sorted_by_position("x"))
        for rect in (left, right):
            assert abs(rect["width"] - workspace["width"] / 2) < Tolerance.ALIGNMENT, (
                f"two windows should split evenly: {left} | {right}"
            )

        invoke_resize(shell_proxy, "WindowResizeRight", focus_window="leftmost")
        left_after, right_after = (
            w["rect"]
            for w in wait_for_stable(lambda: window_helper.get_windows_sorted_by_position("x"))
        )

        grown = left_after["width"] - left["width"]
        shrunk = right["width"] - right_after["width"]
        assert grown > Tolerance.RESIZE_MIN_DELTA, f"left should grow: {left} -> {left_after}"
        assert abs(grown - shrunk) <= Tolerance.POSITION, (
            f"right should shrink by what left grew ({grown}), shrank by {shrunk}"
        )
        assert abs(left_after["x"] - left["x"]) <= Tolerance.POSITION, "left edge moved"
        right_edge = right["x"] + right["width"]
        right_edge_after = right_after["x"] + right_after["width"]
        assert abs(right_edge_after - right_edge) <= Tolerance.POSITION, "right edge moved"
        assert left_after["x"] + left_after["width"] <= right_after["x"], (
            f"windows overlap: {left_after} | {right_after}"
        )

    def test_windows_fill_workspace(self, shell_proxy, window_helper, three_windows):
        """Verify windows together fill most of the workspace."""
        window1, window2, window3 = three_windows

        wait_for_window_count(shell_proxy, 3)
        # The fill check fails on overlap, so let the third window's reflow land.
        wait_for_layout_settled(shell_proxy, window_helper.get_workspace_rect())

        # forge-74p: an 80% threshold for a test literally named "fill" tolerated a
        # fifth of the work area going uncovered. Reuse the shared helper (DRY) at
        # its standard FILL_RATIO (0.85) — three gapped tiles cover well above that.
        window_helper.assert_windows_fill_workspace()


class TestBug057SplitConSiblings:
    """
    Bug #57: Do not stack nor put as tab windows with split con siblings.

    Problem: When a window W has a split container [A B] as a sibling, toggling
    stacked layout on the parent container incorrectly absorbs W, A, and B into
    the same stack group, flattening the nested split.

    forge-3h8p: the old tests never constructed this topology (no Split action)
    and asserted only window counts — a faithful #57 regression changes no
    counts. Worse, their toggle_stacked() was a silent no-op because the
    stacked-mode-enabling fixture was scoped to TestBug125 only. This now
    mirrors test_stacked_tabbed.py::TestTabbedNestedSplitCon for STACKED.
    """

    @pytest.fixture(autouse=True)
    def _enable_stacked_tabbed_modes(self, restore_settings):
        """Stacked mode defaults OFF; without it StackedLayoutToggle bails early."""
        restore_settings.set_stacked_tiling_mode_enabled(True)
        restore_settings.set_tabbed_tiling_mode_enabled(True)

    def test_window_count_stable_after_layout_toggle(self, shell_proxy, input_sim, three_windows):
        """Verify toggling layout preserves window count."""
        window1, window2, window3 = three_windows

        # Get initial window count
        initial_windows = wait_for_window_count(shell_proxy, 3)
        initial_count = len(initial_windows)
        assert initial_count >= 3, f"Expected 3 windows, got {initial_count}"

        # Toggle layout multiple times (count must stay stable across each).
        input_sim.toggle_layout()
        after_toggle1 = wait_for_window_count(shell_proxy, initial_count)
        assert len(after_toggle1) == initial_count, (
            f"Window count changed from {initial_count} to {len(after_toggle1)}"
        )

        input_sim.toggle_layout()
        after_toggle2 = wait_for_window_count(shell_proxy, initial_count)
        assert len(after_toggle2) == initial_count, (
            f"Window count changed from {initial_count} to {len(after_toggle2)}"
        )

    def test_stacked_toggle_preserves_split_con_sibling(
        self, shell_proxy, input_sim, two_windows, launch_window
    ):
        """Stacking a window with a split-con sibling must not absorb the con."""
        # Build CON[wA, conH[wB, wC]] nested under the monitor (same recipe as
        # the forge-37r tabbed test).
        input_sim.split_vertical()  # nest the focused window into a VSPLIT con
        launch_window()  # -> conV[wA, wB]
        input_sim.split_horizontal()  # split focused wB -> conV[wA, conH[wB]]
        launch_window()  # -> conH[wB, wC]
        assert len(shell_proxy.get_windows()) == 4, "expected four windows before stacking"

        # Deterministically focus wA (the window sibling of the nested con),
        # then toggle stacked on their shared parent.
        assert shell_proxy.eval(FOCUS_WINDOW_SIBLING_OF_CON) == "activated"
        time.sleep(Timing.LAYOUT_CHANGE)
        input_sim.toggle_stacked()

        # All four windows survive the toggle.
        assert len(shell_proxy.get_windows()) == 4, "windows lost after stacking"

        # The Bug #57 assertion: the nested split-con is preserved as ONE stack
        # item — a CON child of the STACKED node still holding both windows.
        # Absorbing/flattening would leave the STACKED node with no CON child.
        counts = con_child_window_counts(shell_proxy, "STACKED")
        assert counts, "no STACKED node has a CON child (split-con sibling was absorbed)"
        assert any(c >= 2 for c in counts), (
            f"split-con sibling did not keep its windows as one stack item; counts={counts}"
        )


class TestLayoutModePreservation:
    """Test that layout modes are correctly preserved and toggled."""

    def test_default_layout_is_split(self, shell_proxy, two_windows):
        """Verify default layout splits windows (not stacked/tabbed)."""
        window1, window2 = two_windows

        # Get window positions
        windows = wait_for_window_count(shell_proxy, 2)
        assert len(windows) >= 2, f"Expected 2 windows, got {len(windows)}"

        # Sort by x position
        sorted_windows = sorted(windows, key=lambda w: w.get("rect", {}).get("x", 0))
        rect1 = sorted_windows[0].get("rect", {})
        rect2 = sorted_windows[1].get("rect", {})

        # In split mode (HSPLIT or VSPLIT), windows should not overlap significantly
        # Calculate overlap
        x_overlap = max(
            0,
            min(
                rect1.get("x", 0) + rect1.get("width", 0), rect2.get("x", 0) + rect2.get("width", 0)
            )
            - max(rect1.get("x", 0), rect2.get("x", 0)),
        )
        y_overlap = max(
            0,
            min(
                rect1.get("y", 0) + rect1.get("height", 0),
                rect2.get("y", 0) + rect2.get("height", 0),
            )
            - max(rect1.get("y", 0), rect2.get("y", 0)),
        )
        overlap_area = x_overlap * y_overlap

        # Windows in split mode should have minimal overlap
        window_area = rect1.get("width", 0) * rect1.get("height", 0)
        if window_area > 0:
            overlap_ratio = overlap_area / window_area
            assert overlap_ratio < 0.1, (
                f"Windows overlap too much for split layout: {overlap_ratio * 100:.1f}%"
            )

    def test_toggle_changes_window_dimensions(self, shell_proxy, input_sim, two_windows):
        """Verify toggle_layout changes window dimensions (width/height ratio)."""
        window1, window2 = two_windows

        # Get initial window dimensions
        shell_proxy.ensure_focus()
        layout_before = shell_proxy.get_container_layout()
        windows_before = wait_for_window_count(shell_proxy, 2)
        dims_before = [
            (w.get("rect", {}).get("width", 0), w.get("rect", {}).get("height", 0))
            for w in windows_before
        ]

        # Toggle layout (HSPLIT -> VSPLIT or vice versa)
        input_sim.toggle_layout()

        # forge-2ij: settle on the toggled layout before reading geometry —
        # wait_for_window_count returns immediately (2 windows already exist) and
        # would otherwise let dims_after be sampled mid-relayout under Xvfb.
        expected = "VSPLIT" if layout_before == "HSPLIT" else "HSPLIT"
        wait_for_layout(shell_proxy, expected)
        windows_after = shell_proxy.get_windows()
        dims_after = [
            (w.get("rect", {}).get("width", 0), w.get("rect", {}).get("height", 0))
            for w in windows_after
        ]

        # In a toggle from HSPLIT to VSPLIT:
        # - Windows should become wider (width increases)
        # - Windows should become shorter (height decreases)
        # Or the opposite if toggling the other way

        assert len(dims_before) >= 2 and len(dims_after) >= 2, "expected two tiled windows"

        # Average width/height aspect ratio across the windows.
        ratio_before = sum(d[0] / max(d[1], 1) for d in dims_before) / len(dims_before)
        ratio_after = sum(d[0] / max(d[1], 1) for d in dims_after) / len(dims_after)

        # forge-izt: the old test computed ratio_change then never asserted it,
        # falling back to a vacuous "all dimensions > 0". A real HSPLIT<->VSPLIT
        # toggle inverts the aspect ratio (half-width/full-height becomes
        # full-width/half-height), so the average ratio must shift substantially.
        # On the landscape headless work area the change is ~2.7; require > 1.0 to
        # stay clear of gap/decoration jitter while still failing a no-op toggle.
        ratio_change = abs(ratio_before - ratio_after)
        assert ratio_change > 1.0, (
            f"toggle did not change window proportions: aspect ratio "
            f"{ratio_before:.2f} -> {ratio_after:.2f} (change {ratio_change:.2f})"
        )


class TestWindowDimensions:
    """Test that window dimensions are calculated correctly."""

    def test_single_window_dimensions(self, shell_proxy, window_helper, test_window):
        """Verify single window fills workspace correctly."""
        wait_for_window_count(shell_proxy, 1)

        # forge-3h8p: the fill assertion was wrapped in `if wm_class:` — a setup
        # glitch yielding a class-less window dict made the test pass with zero
        # behavioral assertions. Fail loudly instead.
        wm_class = test_window.get("wmClass")
        assert wm_class, f"launched window has no wmClass: {test_window}"
        window_helper.assert_window_fills_workspace(wm_class)

    def test_two_windows_equal_size(self, shell_proxy, two_windows):
        """Verify two tiled windows have approximately equal size."""
        window1, window2 = two_windows

        windows = wait_for_window_count(shell_proxy, 2)
        assert len(windows) >= 2, f"Expected 2 windows, got {len(windows)}"

        rect1 = windows[0].get("rect", {})
        rect2 = windows[1].get("rect", {})

        width_diff = abs(rect1.get("width", 0) - rect2.get("width", 0))
        height_diff = abs(rect1.get("height", 0) - rect2.get("height", 0))

        # forge-3h8p: the old `width_diff < 100 OR height_diff < 100` was always
        # satisfied in HSPLIT (heights are equal regardless of how the widths
        # split), so a 90/10 split passed a test named "equal size". Two evenly
        # tiled windows must match in BOTH dimensions, whatever the split axis.
        assert width_diff < 100 and height_diff < 100, (
            f"Windows should have equal dimensions: "
            f"width diff={width_diff}, height diff={height_diff}"
        )
