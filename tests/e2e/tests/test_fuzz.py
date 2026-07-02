"""Live fuzzer pytest entry (forge-cnrc).

Opt-in lane: marked `fuzz` and excluded from the default suite (run-tests.sh adds
`-m "not fuzz"` when no marker is given). Run it with `make e2e-fuzz`.

Env knobs (all optional):
    FORGE_FUZZ_SESSIONS   number of seeded sessions               (default 1)
    FORGE_FUZZ_STEPS      steps per session                       (default 30)
    FORGE_FUZZ_SEED       base seed; session i uses base+i        (default 1)
    FORGE_FUZZ_WINDOWS    initial windows per session             (default 2)
    FORGE_FUZZ_SHRINK     1 to ddmin a failure, 0 to skip         (default 1)
    FORGE_FUZZ_SHRINK_K   K-times replay per shrink candidate     (default 3)
    FORGE_FUZZ_CONTINUE   1 to run all sessions + summarize, 0 to abort on first (default 0)
    FORGE_FUZZ_REPLAY     path to a repro JSON for test_fuzz_replay (skips if unset)

The fuzz library (generator / engine / shrinker) lives in tests/e2e/fuzz/; this file
is just the pytest harness so the default `testpaths = tests` collection picks it up.
"""

import json
import os
import warnings
from pathlib import Path

import pytest
from fuzz import shrink
from fuzz.engine import FuzzEngine

# tests/e2e (this file is tests/e2e/tests/test_fuzz.py).
_E2E_ROOT = Path(__file__).resolve().parents[1]
_RESULTS_DIR = Path(os.environ.get("FORGE_E2E_RESULTS_DIR") or (_E2E_ROOT / "e2e-results")) / "fuzz"


def _env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@pytest.fixture
def fuzz_engine(shell_proxy, launch_window):
    """Engine wired to the real shell. launch_window (conftest) reuses _launch_window
    and rides clean_workspace for setup/teardown, so the working set starts empty.

    FORGE_FUZZ_AUTOSPLIT selects the nesting band: unset = leave Forge's auto-split as-is,
    "1" = ON (new windows auto-nest -> deep trees), "0" = OFF (flat) — forge-cnrc depth review.
    """
    asplit = os.environ.get("FORGE_FUZZ_AUTOSPLIT")
    auto_split = None if asplit is None else asplit.strip() == "1"
    engine = FuzzEngine(shell_proxy, launch_window, results_dir=_RESULTS_DIR, auto_split=auto_split)
    yield engine
    # forge-4b6: run_session only resets state at session START (so each seed starts
    # from a clean baseline); nothing reset what the LAST steps left behind, so fuzz
    # chaos leaked into every later test in the shared session. The observed killer:
    # a leaked tiling-mode-enabled=false floats every subsequent window at Mutter
    # cascade placement — 39 downstream failures with overlap/no-op fingerprints.
    # Reset here so the fuzz lane is suite-safe regardless of where it runs.
    # Best-effort: a dead shell must not mask the test's own result.
    try:
        engine._reset_workspace()
    except Exception as e:  # noqa: BLE001
        warnings.warn(f"fuzz post-session reset failed: {e}")


@pytest.mark.fuzz
def test_fuzz_session(fuzz_engine):
    """Run seeded random sessions; on a violation, shrink + persist + fail.

    By default the FIRST failing session aborts the run. With FORGE_FUZZ_CONTINUE=1 every
    failing session is instead persisted (and shrunk, if FORGE_FUZZ_SHRINK is on), recorded,
    and the run continues; at the end a summary is printed and the test fails once with the
    total count (or passes if zero) — so one campaign surfaces many bugs (m7).
    """
    sessions = _env_int("FORGE_FUZZ_SESSIONS", 1)
    steps = _env_int("FORGE_FUZZ_STEPS", 30)
    base_seed = _env_int("FORGE_FUZZ_SEED", 1)
    initial_windows = _env_int("FORGE_FUZZ_WINDOWS", 4)
    do_shrink = _env_int("FORGE_FUZZ_SHRINK", 1) == 1
    shrink_k = _env_int("FORGE_FUZZ_SHRINK_K", 3)
    continue_mode = _env_int("FORGE_FUZZ_CONTINUE", 0) == 1

    found = []  # (seed, rule, step_index, detail) for the end-of-run summary.

    for i in range(sessions):
        seed = base_seed + i
        print("\n[fuzz] session %d/%d seed=%d steps=%d" % (i + 1, sessions, seed, steps))
        failure = fuzz_engine.run_session(seed, steps, initial_windows=initial_windows)
        # Peak achieved tree shape this session (depth instrumentation) — the proof a run is
        # actually building deep/nested trees rather than a shallow fan (forge-cnrc).
        stats = fuzz_engine.session_stats_str()
        if failure is None:
            # Leak metric is a LOGGED line (Angle 3), never a session failure (see engine).
            print(
                "[fuzz] session seed=%d: clean (%s) [%s]"
                % (seed, stats, fuzz_engine.resource_summary_str())
            )
            continue

        # Found a violation. Persist the raw repro immediately (before any shrink work
        # that could itself wedge the shell), then try to minimise.
        raw_path = fuzz_engine.persist(failure)
        print(
            "[fuzz] FAILURE seed=%d rule=%s @step %d (%s)\n  %s\n  raw repro: %s"
            % (seed, failure.rule, failure.step_index, stats, failure.detail, raw_path)
        )

        min_steps = failure.steps
        orig_len = len(failure.steps)
        info = {}
        # A dead/unresponsive shell can't be replayed; don't attempt to shrink it.
        replayable = failure.rule not in ("shell-dead", "shell-unresponsive")
        if do_shrink and replayable:
            min_steps, info = shrink.ddmin(
                fuzz_engine,
                failure.steps,
                expect_rule=failure.rule,
                k=shrink_k,
                log=lambda m: print("  " + m),
            )
            failure.steps = min_steps
            min_path = fuzz_engine.persist(failure, suffix=".min")
            print(
                "[fuzz] shrank %d -> %d steps (%s); min repro: %s"
                % (orig_len, len(min_steps), info, min_path)
            )

        found.append((seed, failure.rule, failure.step_index, failure.detail))

        if not continue_mode:
            pytest.fail(
                "Fuzz violation [%s] seed=%d (%d-step repro%s):\n%s\n\nDetail: %s"
                % (
                    failure.rule,
                    seed,
                    len(min_steps),
                    "" if not info else ", shrink=%s" % info,
                    shrink.summarize(min_steps),
                    failure.detail,
                ),
                pytrace=False,
            )

    if found:
        lines = ["[fuzz] %d failing session(s):" % len(found)]
        for seed, rule, step_index, detail in found:
            lines.append("  seed=%d rule=%s @step %d: %s" % (seed, rule, step_index, detail))
        summary = "\n".join(lines)
        print("\n" + summary)
        pytest.fail(summary, pytrace=False)


@pytest.mark.fuzz
def test_fuzz_replay(fuzz_engine):
    """Deterministically replay a saved repro and assert its rule reproduces.

    This is how a fuzz-found bug graduates into a permanent regression test: point
    FORGE_FUZZ_REPLAY at the committed repro-<seed>.min.json. Skipped when unset.
    """
    replay_path = os.environ.get("FORGE_FUZZ_REPLAY")
    if not replay_path:
        pytest.skip("FORGE_FUZZ_REPLAY not set")

    data = json.loads(Path(replay_path).read_text())
    steps = data["steps"]
    expect_rule = data.get("rule")
    print("\n[fuzz] replay %s (expect rule=%s, %d steps)" % (replay_path, expect_rule, len(steps)))

    hit = fuzz_engine.replay(steps, expect_rule=expect_rule)
    assert hit is not None, "repro did not reproduce any violation"
    if expect_rule:
        assert hit[0] == expect_rule, "expected rule %s, got %s (%s)" % (
            expect_rule,
            hit[0],
            hit[1],
        )


def _live_window_classes(shell_proxy):
    """Sorted multiset of live window wm-classes on the active workspace (diff comparable)."""
    wins = shell_proxy.get_windows()
    if not isinstance(wins, list):
        return []
    return sorted(w.get("wmClass") for w in wins if isinstance(w, dict))


@pytest.mark.fuzz
def test_fuzz_autosplit_differential(shell_proxy, launch_window):
    """5b: the SAME step list under FORGE_FUZZ_AUTOSPLIT ON vs OFF must differ ONLY in the
    documented way — tree DEPTH/nesting. Opt-in via FORGE_FUZZ_DIFF=1 so default runs are
    unaffected.

    LOW-false-positive RELATIVE property (NOT tree-shape equality — nesting differences are
    EXPECTED and never flagged):
      (a) neither mode crashes or trips the structural oracle, and
      (b) both modes end with the SAME COUNT of live windows (spawns/closes are the same steps,
          so the working set must stay in lock-step regardless of nesting).
    The live wm-class multiset is compared too but only LOGGED: a `close` targets Mutter's
    focused window, which the two modes can legitimately leave on different windows, so a class
    mismatch is not a sound failure.
    """
    if _env_int("FORGE_FUZZ_DIFF", 0) != 1:
        pytest.skip("FORGE_FUZZ_DIFF not set")

    seed = _env_int("FORGE_FUZZ_SEED", 1)
    steps = _env_int("FORGE_FUZZ_STEPS", 30)
    initial_windows = _env_int("FORGE_FUZZ_WINDOWS", 4)
    print("\n[fuzz] autosplit differential seed=%d steps=%d" % (seed, steps))

    try:
        # Mode ON: generate + execute, capturing the exact executed step list for replay.
        engine_on = FuzzEngine(
            shell_proxy, launch_window, results_dir=_RESULTS_DIR, auto_split=True
        )
        failure_on = engine_on.run_session(seed, steps, initial_windows=initial_windows)
        step_list = list(engine_on.last_steps())
        classes_on = _live_window_classes(shell_proxy)
        print(
            "[fuzz]   ON: failure=%s windows=%d (%s)"
            % (
                None if failure_on is None else failure_on.rule,
                len(classes_on),
                engine_on.session_stats_str(),
            )
        )

        # Mode OFF: REPLAY the identical step list (engine_off pins auto-split off via _reset).
        engine_off = FuzzEngine(
            shell_proxy, launch_window, results_dir=_RESULTS_DIR, auto_split=False
        )
        hit_off = engine_off.replay(step_list, expect_rule=None)
        classes_off = _live_window_classes(shell_proxy)
        print(
            "[fuzz]   OFF: violation=%s windows=%d (%s)"
            % (hit_off, len(classes_off), engine_off.session_stats_str())
        )
    finally:
        # forge-4b6: suite-safety, mirroring the fuzz_engine fixture teardown — this
        # test builds its own engines, so reset the leaked session state itself
        # (auto_split=False is the schema default, so the pin restores the default too).
        # Best-effort: a dead shell must not mask the test's own failure.
        try:
            FuzzEngine(
                shell_proxy, launch_window, results_dir=_RESULTS_DIR, auto_split=False
            )._reset_workspace()
        except Exception as e:  # noqa: BLE001
            warnings.warn(f"fuzz differential reset failed: {e}")

    if classes_on != classes_off:
        # Documented-divergence-tolerant: log, don't fail (focus-dependent close, see docstring).
        print(
            "[fuzz]   note: live class multisets differ (ON=%s OFF=%s)" % (classes_on, classes_off)
        )

    # (a) both modes clean.
    assert failure_on is None, "autosplit=ON tripped: %s" % (
        failure_on.rule if failure_on else None
    )
    assert hit_off is None, "autosplit=OFF replay tripped: %s" % (hit_off,)
    # (b) same live window count — the robust relative invariant.
    assert len(classes_on) == len(classes_off), (
        "live window COUNT diverged between autosplit modes: ON=%d OFF=%d"
        % (len(classes_on), len(classes_off))
    )
