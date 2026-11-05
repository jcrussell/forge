"""
Self-test for the layout fill check behind assert_windows_fill_workspace and
wait_for_layout_settled (forge-noi2). Pure geometry: no shell calls.
"""

from framework.geometry import layout_fill_error

WORKSPACE = (0, 32, 1920, 1048)
GAP = 4


def _tiles(n):
    """n gapped side-by-side tiles across WORKSPACE, as Forge lays out an HSPLIT."""
    x, y, w, h = WORKSPACE
    width = w // n
    return [(x + i * width + GAP, y + GAP, width - 2 * GAP, h - 2 * GAP) for i in range(n)]


class TestLayoutFillError:
    def test_gapped_tiles_pass(self):
        for n in (1, 2, 3):
            assert layout_fill_error(_tiles(n), WORKSPACE) is None

    def test_overlapping_full_width_windows_fail(self):
        full = _tiles(1)[0]
        error = layout_fill_error([full, full], WORKSPACE)
        assert error is not None and "overlap" in error

    def test_off_workspace_area_does_not_count(self):
        x, y, w, h = WORKSPACE
        # One half-width tile plus a window entirely to the right of the work area.
        error = layout_fill_error([(x, y, w // 2, h), (x + w, y, w, h)], WORKSPACE)
        assert error is not None and "fill only" in error

    def test_uncovered_half_fails(self):
        error = layout_fill_error(_tiles(2)[:1], WORKSPACE)
        assert error is not None and "fill only" in error
