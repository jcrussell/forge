"""ddmin shrinker with K-times replay (forge-cnrc).

Given a failing step list, find a 1-minimal subsequence that still reproduces the SAME
rule. This is the complement-based delta-debugging minimisation (Zeller & Hildebrandt).

Soundness caveat: the shell is not bit-deterministic. A chunk is DROPPED only when a
MAJORITY (>= ceil(K/2)) of K replays of the complement still reproduce the rule, so a
single flaky hit can't justify discarding a needed step (which would yield a
non-reproducing "minimization" — wrong, not merely larger). The cost is the opposite
bias: a genuinely-droppable chunk whose repro is itself flaky may be KEPT, leaving the
result LESS minimal. After ddmin the final sequence is re-validated once at the lenient
>=1-of-K bar and info["revalidated"] records whether it still trips. A hard budget (test
count + wall-clock) caps the search; whatever is reached is reported, with a note when
the budget cut it short.
"""

from __future__ import annotations

import time

from .actions import describe


def _split(seq, n):
    """Split seq into n roughly-equal contiguous chunks."""
    k, m = divmod(len(seq), n)
    out = []
    start = 0
    for i in range(n):
        size = k + (1 if i < m else 0)
        out.append(seq[start : start + size])
        start += size
    return [c for c in out if c]


def ddmin(engine, steps, expect_rule, k=3, max_tests=120, max_seconds=1800, log=None):
    """Return (minimized_steps, info). info has 'tests', 'truncated', 'elapsed'.

    engine.reproduces(subseq, expect_rule, k) is the oracle. Each call is k full
    replays, so the budget is deliberately tight.
    """
    say = log or (lambda *_: None)
    seq = list(steps)
    start = time.time()
    tests = 0
    truncated = False
    # Drop a chunk only on a MAJORITY of K replays (>= ceil(K/2)), not the lenient >=1 — a
    # single flaky hit must not discard a needed step (m6).
    majority = (k + 1) // 2

    def over_budget():
        return tests >= max_tests or (time.time() - start) >= max_seconds

    def reproduces(candidate):
        nonlocal tests
        tests += 1
        return engine.reproduces(candidate, expect_rule, k=k, min_hits=majority)

    n = 2
    while len(seq) >= 2:
        if over_budget():
            truncated = True
            break
        chunks = _split(seq, min(n, len(seq)))
        reduced = False
        for idx, chunk in enumerate(chunks):
            if over_budget():
                truncated = True
                break
            complement = [s for j, c in enumerate(chunks) if j != idx for s in c]
            if not complement:
                continue
            if reproduces(complement):
                say(
                    "ddmin: dropped chunk %d/%d -> %d steps (test #%d)"
                    % (idx + 1, len(chunks), len(complement), tests)
                )
                seq = complement
                n = max(n - 1, 2)
                reduced = True
                break
        if truncated:
            break
        if not reduced:
            if n >= len(seq):
                break
            n = min(len(seq), n * 2)

    # Final sanity check at the lenient >=1-of-K bar: the majority drop bar can leave a
    # sequence that no longer trips on a single replay, so confirm and record it.
    revalidated = engine.reproduces(seq, expect_rule, k=k, min_hits=1)
    info = {
        "tests": tests,
        "truncated": truncated,
        "elapsed": round(time.time() - start, 1),
        "revalidated": revalidated,
    }
    return seq, info


def summarize(steps):
    """Human-readable numbered step list."""
    return "\n".join("  %2d. %s" % (i, describe(s)) for i, s in enumerate(steps))
