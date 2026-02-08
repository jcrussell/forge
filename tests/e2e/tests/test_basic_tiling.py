"""
Basic Tiling Tests for Forge.

Tests fundamental tiling behavior:
- Single window fills workspace
- Two windows split 50/50
- Three windows layout correctly
"""

import pytest

from framework.constants import Timing, Tolerance


class TestBasicTiling:
    """Test basic tiling functionality."""

    def test_single_window_fills_workspace(self, window_helper, test_window):
        """A single tiled window should fill the entire workspace."""
        wm_class = test_window.get("wmClass")
        assert wm_class, "Test window should have a WM class"
        window_helper.assert_window_fills_workspace(wm_class)

    def test_two_windows_split_horizontally(self, shell_proxy, window_helper, two_windows):
        """Two windows should split the workspace 50/50 horizontally by default."""
        import time
        time.sleep(0.5)  # Wait for Forge to tile

        # Fetch fresh window positions from GNOME Shell (fixtures have stale data)
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, f"Expected 2 windows, got {len(windows)}"

        workspace = window_helper.get_workspace_rect()
        expected_width = workspace["width"] // 2

        # Sort windows by x position
        sorted_windows = sorted(windows, key=lambda w: w.get("rect", {}).get("x", 0))
        rect1 = sorted_windows[0].get("rect", {})
        rect2 = sorted_windows[1].get("rect", {})

        assert abs(rect1.get("width", 0) - expected_width) < Tolerance.ALIGNMENT, (
            f"Window 1 width {rect1.get('width')} should be ~{expected_width}"
        )
        assert abs(rect2.get("width", 0) - expected_width) < Tolerance.ALIGNMENT, (
            f"Window 2 width {rect2.get('width')} should be ~{expected_width}"
        )

        # Check windows are side by side
        left_end = rect1.get("x", 0) + rect1.get("width", 0)
        right_start = rect2.get("x", 0)
        # Allow for gap between windows
        assert right_start >= left_end - Tolerance.ALIGNMENT, (
            f"Windows should be side by side: left ends at {left_end}, right starts at {right_start}"
        )

    def test_two_windows_equal_height(self, window_helper, two_windows):
        """Two horizontally split windows should have equal height."""
        window1, window2 = two_windows
        wm_class1 = window1.get("wmClass")
        wm_class2 = window2.get("wmClass")
        window_helper.assert_windows_equal_height(wm_class1, wm_class2)

    def test_three_windows_layout(self, shell_proxy, window_helper, three_windows):
        """Three windows should tile appropriately."""
        window1, window2, window3 = three_windows

        windows = shell_proxy.get_windows()
        assert len(windows) >= 3, f"Expected 3 windows, got {len(windows)}"

        # All windows should have reasonable dimensions
        for window in [window1, window2, window3]:
            wm_class = window.get("wmClass")
            if wm_class:
                rect = window_helper.get_window_rect(wm_class)
                assert rect[2] > 100, f"Window width too small: {rect[2]}"
                assert rect[3] > 100, f"Window height too small: {rect[3]}"

    def test_windows_dont_overlap(self, shell_proxy, two_windows):
        """Tiled windows should not overlap."""
        import time
        time.sleep(0.5)  # Wait for Forge to tile

        # Fetch fresh window positions
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, f"Expected 2 windows, got {len(windows)}"

        rect1 = windows[0].get("rect", {})
        rect2 = windows[1].get("rect", {})

        # Calculate overlap
        x_overlap = max(
            0,
            min(rect1["x"] + rect1["width"], rect2["x"] + rect2["width"])
            - max(rect1["x"], rect2["x"]),
        )
        y_overlap = max(
            0,
            min(rect1["y"] + rect1["height"], rect2["y"] + rect2["height"])
            - max(rect1["y"], rect2["y"]),
        )
        overlap_area = x_overlap * y_overlap

        assert overlap_area <= Tolerance.OVERLAP, (
            f"Windows overlap by {overlap_area} pixels (max allowed: {Tolerance.OVERLAP})"
        )

    def test_windows_fill_workspace(self, shell_proxy, window_helper, two_windows):
        """Tiled windows should together fill most of the workspace."""
        workspace = window_helper.get_workspace_rect()
        workspace_area = workspace["width"] * workspace["height"]

        windows = shell_proxy.get_windows()
        total_window_area = sum(
            w.get("rect", {}).get("width", 0) * w.get("rect", {}).get("height", 0)
            for w in windows
        )

        fill_ratio = total_window_area / workspace_area
        assert fill_ratio > Tolerance.FILL_RATIO, (
            f"Windows only fill {fill_ratio*100:.1f}% of workspace"
        )


class TestWindowGaps:
    """Test window gap behavior."""

    def test_gaps_between_windows(self, shell_proxy, two_windows):
        """Windows should have gaps between them when configured."""
        import time
        time.sleep(0.5)  # Wait for Forge to tile

        # Fetch fresh window positions
        windows = shell_proxy.get_windows()
        assert len(windows) >= 2, f"Expected 2 windows, got {len(windows)}"

        # Sort by x position to determine left/right
        sorted_windows = sorted(windows, key=lambda w: w.get("rect", {}).get("x", 0))
        left = sorted_windows[0].get("rect", {})
        right = sorted_windows[1].get("rect", {})

        # Gap = left edge of right window - right edge of left window
        gap = right.get("x", 0) - (left.get("x", 0) + left.get("width", 0))

        # Gap should be non-negative (windows not overlapping)
        assert gap >= 0, f"Windows should have gap, but overlap by {-gap}px"
