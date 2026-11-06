"""
Pure rectangle math for layout assertions (no shell access).

Rects are (x, y, width, height) tuples; window and workspace dicts from the
bridge are converted with ``as_rect``.
"""

from typing import Optional, Sequence, Tuple

from .constants import Tolerance

Rect = Tuple[int, int, int, int]


def as_rect(d: dict) -> Rect:
    """Convert a bridge rect dict ({x, y, width, height}) to a tuple."""
    return (d.get("x", 0), d.get("y", 0), d.get("width", 0), d.get("height", 0))


def intersect(a: Rect, b: Rect) -> Rect:
    """Intersection of two rects; zero width/height when they do not meet."""
    x, y = max(a[0], b[0]), max(a[1], b[1])
    w = max(0, min(a[0] + a[2], b[0] + b[2]) - x)
    h = max(0, min(a[1] + a[3], b[1] + b[3]) - y)
    return (x, y, w, h)


def overlap_area(a: Rect, b: Rect) -> int:
    """Overlapping pixel area of two rects."""
    _, _, w, h = intersect(a, b)
    return w * h


def layout_fill_error(
    rects: Sequence[Rect],
    workspace: Rect,
    fill_ratio: float = Tolerance.FILL_RATIO,
    max_overlap: int = Tolerance.OVERLAP,
) -> Optional[str]:
    """
    Check that rects tile the workspace: no pair overlaps by more than
    ``max_overlap`` pixels and together they cover at least ``fill_ratio`` of it.

    Each rect is clipped to the workspace first, so area off-screen or under a
    neighbour cannot make up for a gap. Gapped tiles never overlap, so any real
    overlap means a stale or wrong rect.

    Returns None when the layout passes, otherwise a description of the failure.
    """
    ws_area = workspace[2] * workspace[3]
    if ws_area <= 0:
        return f"workspace has no area: {workspace}"
    clipped = [intersect(r, workspace) for r in rects]
    for i in range(len(clipped)):
        for j in range(i + 1, len(clipped)):
            overlap = overlap_area(clipped[i], clipped[j])
            if overlap > max_overlap:
                return (
                    f"windows {rects[i]} and {rects[j]} overlap by {overlap} pixels "
                    f"(max allowed: {max_overlap})"
                )
    ratio = sum(w * h for _, _, w, h in clipped) / ws_area
    if ratio < fill_ratio:
        return (
            f"windows fill only {ratio * 100:.1f}% of workspace (minimum: {fill_ratio * 100:.1f}%)"
        )
    return None
