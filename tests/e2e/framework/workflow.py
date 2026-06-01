"""
Workflow-test helpers for Forge E2E.

A "workflow" is a multi-step E2E test that launches a small window set once and
drives it through many sequenced operations (layout toggle, resize, swap, focus,
float, snap, gap, close, open). Workflows amortize the ~10.5s-per-window launch
cost across many assertions and exercise realistic state transitions the atomic
one-op-per-test suite never covers. They coexist with — and do not replace — the
atomic tests, which remain the pinpoint regression net.

This module holds the small shared helpers workflows lean on:
- step(): label a step on the screencast (when recording) and annotate failures.
- invoke_resize(): the deterministic keyboard-resize driver (also used by the
  atomic test_keyboard_resize suite).
"""

import os
import time
from contextlib import contextmanager

from .constants import Timing


@contextmanager
def step(shell_proxy, label):
    """Mark a workflow step.

    On the recording lane (FORGE_E2E_RECORD=1) this burns the step label onto the
    screencast overlay so a multi-step run is self-documenting; on normal lanes it
    is a no-op (zero extra D-Bus eval). On failure it attaches the label as a note
    via Exception.add_note WITHOUT replacing the exception — pytest keeps its
    assert-rewriting introspection and blames the real failing line, while the
    "[workflow step: ...]" note names which step died. (Re-raising a new
    AssertionError would discard both, and under --tb=short the chained cause is
    truncated.) Fail-fast is inherent to pytest; this only labels.

    Use for assertion-only or raw invoke_forge_action steps. Don't wrap a bare
    input_sim.* call — InputSimulator._dispatch already labels those when
    recording, and double-labeling flickers the overlay.
    """
    if os.environ.get("FORGE_E2E_RECORD") == "1":
        try:
            shell_proxy.set_recording_action(label)
        except Exception:
            pass  # never fail a test over the diagnostic overlay
    try:
        yield
    except Exception as e:
        e.add_note(f"[workflow step: {label}]")
        raise


def invoke_resize(shell_proxy, action_name, count=5, amount=50, focus_window=None):
    """Invoke a resize action multiple times via D-Bus.

    also_activate=True: keyboard resize persists the tree split-ratio from the
    async 'size-changed' signal, which re-reads the real focused window after the
    get_focus_window override is restored. The target must therefore be genuinely
    focused, not just hinted, or the async handler targets a node with no active
    grab and resets the layout so the resize never sticks (forge-2n0).
    """
    time.sleep(Timing.RESIZE_SETTLE)
    last_result = None
    for _ in range(count):
        last_result = shell_proxy.invoke_forge_action(
            {"name": action_name, "amount": amount},
            focus_window=focus_window,
            also_activate=True,
        )
        time.sleep(Timing.RESIZE_SETTLE)
    return last_result
