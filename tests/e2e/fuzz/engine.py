"""Fuzz engine: drive steps, settle, check invariants, persist repros (forge-cnrc).

The engine is deliberately stateless w.r.t. randomness — it only *executes* concrete
steps (from actions.generate_step or a saved repro). This is what lets run_session and
replay share one execution path, so a replayed step list does the same thing the
original session did.

Oracle bundle, run after every step (post a forced synchronous render):
  1. liveness  — eval("1"); a throw means the shell died (fatal, not a tree bug).
  2. structure+geometry — bridge.fuzz_check_invariants (the SOUND rule set).
  3. log scan  — new JS ERROR / finalized-object lines on the live gnome-shell log.

A re-readable structure/geometry violation is re-checked once after an extra settle before
it is declared real, to absorb the rare transient (e.g. a chaos step read a hair early).
One-shot findings (log errors, dead/unresponsive shell) are AUTHORITATIVE on first sight and
returned immediately — re-running the oracle would scan past the matched log line (its offset
already advanced) or fail to re-eval a dead shell, losing the finding (B1).
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from framework.constants import APP_PALETTE, DEFAULT_TEST_APP, Timing
from framework.shell_proxy import ShellProxyError
from framework.wait import WaitTimeoutError
from framework.window_helper import drain_all_windows

# Oracle rules sourced from a one-shot, non-re-readable signal: the LogScanner advances its
# byte offset PAST the matched line on read, and a dead/unresponsive shell can't be re-eval'd.
# A FIRST-check hit on one of these is AUTHORITATIVE (returned immediately, no re-confirm);
# every other rule is re-readable structure/geometry and goes through the transient guard (B1).
AUTHORITATIVE_RULES = frozenset({"shell-log-error", "shell-dead", "shell-unresponsive"})

# Live gnome-shell stdout/stderr redirect inside the container
# (docker/scripts/start-user-session.sh). NOT the e2e-results copy, which is only
# written at teardown and is a truncated snapshot.
DEFAULT_SHELL_LOG = "/tmp/gnome-shell.log"

# Substrings that mark a thrown/corruption event in the shell log. JS ERROR is the
# uncaught-exception marker; the finalized/disposed ones are the classic GJS
# use-after-free signatures that a corrupt tree tends to trigger on the next render.
LOG_ERROR_MARKERS = (
    "JS ERROR",
    "has been already finalized",
    "has been already deallocated",
    "already disposed",
    "Attempting to call back into JSAPI",
    # g_critical-level toolkit failures: actor/object corruption that a clean tree never
    # emits (verified: 0 in clean runs). The classic one a tiling bug triggers is
    # "Clutter-CRITICAL ... clutter_actor_add_child: assertion 'child->priv->parent == NULL'
    # failed" — re-parenting an already-parented decoration/tab actor. Catching it here flags
    # the CAUSING step directly, instead of waiting for the shell to later die on a D-Bus call.
    "Clutter-CRITICAL",
    "Gjs-CRITICAL",
    "St-CRITICAL",
)

# A GJS stack frame referencing the Forge extension. A *-CRITICAL whose trailing stack has no
# such frame is GNOME-shell-core noise (not a Forge bug) — see LogScanner.new_errors.
FORGE_FRAME_MARKER = "forge@jmmaranan"


class LogScanner:
    """Byte-offset tail of the live shell log; reports only lines added since the last read."""

    def __init__(self, path=DEFAULT_SHELL_LOG, markers=LOG_ERROR_MARKERS):
        self.path = Path(path)
        self.markers = markers
        self._offset = self._size()

    def _size(self):
        try:
            return self.path.stat().st_size
        except OSError:
            return 0

    def reset(self):
        """Re-seek to EOF (call after a known-noisy setup phase)."""
        self._offset = self._size()

    def new_errors(self):
        """Return Forge-attributable error lines appended since the last call; advance offset.

        A marked critical is kept only if the GJS stack trace immediately following it
        references the Forge extension (FORGE_FRAME_MARKER). GNOME-shell-CORE criticals — e.g.
        "Gjs_ui_workspaceAnimation_MonitorGroup ... already disposed", which GNOME throws on a
        rapid (multi-monitor) workspace switch with a 100%-core stack — carry NO forge frame and
        are filtered: they are not Forge bugs and would otherwise flood switch-heavy / multimon
        runs. A marker with no stack block in this chunk is kept (conservative: a bare uncaught
        error is still suspicious). The critical + its stack are written together synchronously
        by GJS, so they land in the same read chunk.
        """
        try:
            size = self._size()
            if size < self._offset:
                # Log was rotated/truncated; restart from the top.
                self._offset = 0
            with self.path.open("r", errors="replace") as fh:
                fh.seek(self._offset)
                chunk = fh.read()
                self._offset = fh.tell()
        except OSError:
            return []
        lines = chunk.splitlines()
        hits = []
        for i, line in enumerate(lines):
            if not any(m in line for m in self.markers):
                continue
            # Inspect the stack block (if any) immediately after this critical.
            saw_stack = False
            forge_in_stack = False
            for j in range(i + 1, min(len(lines), i + 25)):
                nxt = lines[j]
                if "Stack trace" in nxt:
                    saw_stack = True
                    continue
                if saw_stack:
                    if nxt.lstrip().startswith("#"):  # a stack frame
                        if FORGE_FRAME_MARKER in nxt:
                            forge_in_stack = True
                    else:
                        break  # end of the stack block
            if saw_stack and not forge_in_stack:
                continue  # GNOME-core critical (no forge frame) — not our bug
            hits.append(line.strip())
        return hits


class FuzzFailure(Exception):
    """Raised/returned when the oracle finds a violation. Carries the repro payload."""

    def __init__(self, rule, detail, steps, seed, step_index):
        self.rule = rule
        self.detail = detail
        self.steps = steps
        self.seed = seed
        self.step_index = step_index
        super().__init__("%s at step %d: %s" % (rule, step_index, detail))

    def to_dict(self):
        return {
            "seed": self.seed,
            "rule": self.rule,
            "detail": self.detail,
            "step_index": self.step_index,
            "steps": self.steps,
        }


class FuzzEngine:
    def __init__(
        self,
        shell_proxy,
        launch_fn,
        results_dir,
        log_path=DEFAULT_SHELL_LOG,
        gap=0,
        tol=8,
        auto_split=None,
    ):
        """
        Args:
            shell_proxy: connected ShellProxy.
            launch_fn: zero-arg callable that launches one window and returns its info
                dict (reuse conftest._launch_window). Spawns are ~10s each.
            results_dir: directory for repro artifacts (e2e-results/fuzz).
            gap/tol: geometry overlap slack passed to the bridge oracle (px).
            auto_split: None = leave Forge's auto-split-enabled as-is; True/False = pin it for the
                whole run (the ON band auto-nests new windows into deep trees, OFF is flat) — forge-cnrc.
        """
        self.shell = shell_proxy
        self.launch_fn = launch_fn
        self.results_dir = Path(results_dir)
        self.gap = gap
        self.tol = tol
        self.auto_split = auto_split
        self.log = LogScanner(log_path)
        self._session_stats = {}  # peak {maxDepth,nodes,cons,maxSplitFanout} for the current session
        self._monitor_count = None  # cached per session (headless monitor set is static)
        self._last_steps = []  # last run_session's executed step list (reused by the diff test)
        self._res_baseline = None  # resource counts after the initial settle (leak metric)
        self._res_final = None  # resource counts at session end (leak metric)

    # --- low-level ----------------------------------------------------------------------------

    def _window_count(self):
        wins = self.shell.get_windows()
        return len(wins) if isinstance(wins, list) else 0

    def _monitors(self):
        """Monitor count, cached per session (headless monitor set is static)."""
        if self._monitor_count is None:
            try:
                self._monitor_count = max(1, int(self.shell.get_monitor_count()))
            except Exception:  # noqa: BLE001
                self._monitor_count = 1
        return self._monitor_count

    def _settle(self):
        """Wait for responsiveness, drain async finalizers, then force a synchronous render.

        wait_for_idle only proves the main loop answers D-Bus; the Move/SnapLayoutMove
        (~220ms event-queue) and resize (grab-signal) finalizers can still be mid-flight,
        leaving the tree half-updated when the oracle reads (M3). Poll fuzz_pending_work()
        until it reports not-busy (bounded), THEN force the synchronous render. Defensive:
        any wrapper error / non-dict result falls back to the old behavior so a missing or
        broken bridge method can never hang the run.
        """
        self.shell.wait_for_idle(timeout=5.0, interval=0.2, stable_count=2)
        deadline = time.time() + SETTLE_DRAIN_TIMEOUT
        while time.time() < deadline:
            try:
                pending = self.shell.fuzz_pending_work()
            except Exception:  # noqa: BLE001 - never let backpressure polling hang a run
                break
            if not isinstance(pending, dict) or not pending.get("busy"):
                break
            time.sleep(SETTLE_DRAIN_INTERVAL)
        self.shell.fuzz_render_now()

    def execute(self, step):
        """Apply one concrete step. Returns None; raises ShellProxyError on a hard failure."""
        kind = step.get("kind")
        if kind == "spawn":
            # Spawn the tagged palette app (Angle 2). Legacy/initial-window steps with no tag
            # default to the fast tiled editor.
            self.launch_fn(step.get("app") or DEFAULT_TEST_APP)
            return
        if kind == "close":
            self.shell.close_focused_window()
            return
        if kind == "switch_ws":
            self.shell.activate_workspace(int(step.get("index", 0)))
            return
        if kind == "winstate":
            self.shell.fuzz_window_state(step["op"], focus_window=step.get("focus"))
            return
        if kind == "drag":
            self.shell.fuzz_drag(step.get("src"), step.get("tgt"), step.get("zone"))
            return
        if kind == "drag_path":
            self.shell.fuzz_drag_path(
                step.get("src"), step.get("tgt"), step.get("zone"), step.get("vias")
            )
            return
        if kind == "rehome":
            self.shell.move_focused_window_to_monitor(int(step.get("monitor", 0)))
            return
        if kind == "action":
            action = {"name": step["name"], **(step.get("params") or {})}
            self.shell.invoke_forge_action(
                action,
                focus_window=step.get("focus"),
                also_activate=bool(step.get("also_activate")),
            )
            return
        raise ValueError("unknown step kind: %r" % (kind,))

    def _check(self):
        """Run the oracle bundle once. Return (rule, detail) on violation, else None."""
        # 1. liveness — let a dead shell surface as its own rule (callers treat as fatal).
        try:
            if self.shell.eval("1") is None:
                return ("shell-unresponsive", "eval('1') returned None")
        except Exception as e:  # noqa: BLE001 - any failure here means the shell is gone
            return ("shell-dead", str(e))

        # 2. structure + geometry (render already forced in _settle; skip a second one).
        try:
            res = self.shell.fuzz_check_invariants(gap=self.gap, tol=self.tol, render=False)
        except ShellProxyError as e:
            return ("oracle-eval-failed", str(e))
        if isinstance(res, dict):
            self._record_stats(res.get("stats"))
        if isinstance(res, dict) and not res.get("valid", True):
            violations = res.get("violations") or [{"rule": "unknown", "detail": "no detail"}]
            v = violations[0]
            extra = ("; +%d more" % (len(violations) - 1)) if len(violations) > 1 else ""
            return (
                v.get("rule", "unknown"),
                "%s [%s]%s" % (v.get("detail", ""), v.get("path", ""), extra),
            )

        # 2b. grab-preview-hint leak (forge-leqs/62ja, forge-v9o7): outside an active grab NO tree
        # node may still hold a previewHint. fuzzDragPath drives the real grab loop, so a leak here
        # is a stuck overlay / GRAB_TILE teardown miss. Re-readable: a transient mid-settle hint is
        # absorbed by check_with_retry's settle+recheck. Defensive: any non-dict / error -> skip.
        try:
            ph = self.shell.get_preview_hint_state()
        except ShellProxyError:
            ph = None
        if isinstance(ph, dict) and isinstance(ph.get("count"), int) and ph["count"] > 0:
            return (
                "grab-preview-leak",
                "%d node(s) hold a previewHint outside a grab (visible=%s)"
                % (ph["count"], ph.get("visible")),
            )

        # 2c. focus-correctness (Angle 3, forge-d5mm): after settle, Mutter's focused window must
        # be the tree's active/visible child of its STACKED parent (TABBED not probed — too flaky).
        # The probe is itself
        # conservative (transient states return no violations); kept OUT of AUTHORITATIVE_RULES so
        # a hit still gets check_with_retry's settle+recheck transient guard. Defensive: any
        # non-dict / error -> skip.
        try:
            fm = self.shell.fuzz_focus_mismatch()
        except ShellProxyError:
            fm = None
        if isinstance(fm, dict):
            fviol = fm.get("violations") or []
            if fviol:
                v = fviol[0]
                return (
                    v.get("rule", "focus-mismatch"),
                    "%s [%s]" % (v.get("detail", ""), v.get("path", "")),
                )

        # 3. log scan — thrown exceptions on the live shell log since the last step.
        errs = self.log.new_errors()
        if errs:
            return ("shell-log-error", errs[0])
        return None

    def check_with_retry(self):
        """Check once; re-readable hits get a settle+recheck transient guard.

        A FIRST-check hit on an AUTHORITATIVE rule (log error / dead / unresponsive shell)
        is returned immediately: re-running _check() would scan PAST the matched log line
        (LogScanner already advanced its offset) and lose a real crash (B1). Only re-readable
        structure/geometry violations are re-confirmed after an extra settle.
        """
        first = self._check()
        if first is None:
            return None
        if first[0] in AUTHORITATIVE_RULES:
            return first
        # transient guard: settle harder and look again.
        time.sleep(Timing.WINDOW_SETTLE)
        self._settle()
        return self._check()

    def _record_stats(self, stats):
        """Fold one oracle stats sample into the session peak (maxDepth/nodes/cons/fanout)."""
        if not isinstance(stats, dict):
            return
        for k in ("maxDepth", "nodes", "cons", "maxSplitFanout"):
            v = stats.get(k)
            if isinstance(v, (int, float)) and v > self._session_stats.get(k, 0):
                self._session_stats[k] = v

    def session_stats_str(self):
        """One-line peak-shape summary for the session (depth instrumentation, forge-cnrc)."""
        s = self._session_stats
        return "maxDepth=%d nodes=%d cons=%d fanout=%d" % (
            s.get("maxDepth", 0),
            s.get("nodes", 0),
            s.get("cons", 0),
            s.get("maxSplitFanout", 0),
        )

    def last_steps(self):
        """The most recent run_session's executed step list (reused by the autosplit diff test)."""
        return self._last_steps

    def _resource_counts(self):
        """Cheap leak-metric sample, or None on any error (never perturb a run). Angle 3."""
        try:
            res = self.shell.fuzz_resource_counts()
        except Exception:  # noqa: BLE001
            return None
        return res if isinstance(res, dict) and "error" not in res else None

    def resource_summary_str(self):
        """One-line leak-metric summary for the session (Angle 3, LOGGED — not a failure).

        Reports the end-of-session counts and, when both samples exist, whether the bound-once
        signal total GREW (the only count that should be invariant — a non-growth WARNING, never
        a hard session failure: GJS GC timing makes a stricter assertion flaky).
        """
        f = self._res_final
        if not f:
            return "resources=unavailable"
        base = self._res_baseline or {}
        s = "resources signals=%s timers=%s decorations=%s tabs=%s previewHints=%s" % (
            f.get("signals"),
            f.get("timers"),
            f.get("decorations"),
            f.get("tabs"),
            f.get("previewHints"),
        )
        b_sig, f_sig = base.get("signals"), f.get("signals")
        if isinstance(b_sig, int) and isinstance(f_sig, int) and f_sig > b_sig:
            s += " WARNING signal-leak %d->%d" % (b_sig, f_sig)
        return s

    # --- high-level ---------------------------------------------------------------------------

    def run_session(self, seed, n_steps, initial_windows=2, on_step=None):
        """Generate + execute a fresh seeded session. Return a FuzzFailure or None.

        The initial window spawns are recorded as the first steps so the whole session
        replays as a flat step list.
        """
        import random

        from . import actions

        rng = random.Random(seed)
        self._session_stats = {}  # fresh peak-shape metrics per session (depth instrumentation)
        self._monitor_count = None  # re-probe monitor count for this session
        # Start every seeded session from an empty, ws0 baseline (M1) — switch_ws/GapSize/
        # float chaos from a prior session would otherwise bleed in. Reset BEFORE arming the
        # log scanner so teardown noise isn't mis-read as a finding.
        self._reset_workspace()
        self.log.reset()
        self._res_baseline = None  # leak-metric samples for this session (Angle 3)
        self._res_final = None
        executed = []
        self._last_steps = executed  # same list object, mutated in place; reused by the diff test

        # Seed the working set. Recorded as spawn steps for uniform replay. If the shell is
        # already dead here (e.g. a prior session crashed it in a CONTINUE run), surface that
        # as shell-dead rather than crashing the whole pytest process.
        try:
            for _ in range(initial_windows):
                step = {"kind": "spawn"}
                executed.append(step)
                self.execute(step)
            self._settle()
        except ShellProxyError as e:
            return FuzzFailure("shell-dead", str(e), executed, seed, len(executed) - 1)
        # Leak-metric baseline AFTER the working set is up + settled (Angle 3, logged metric).
        self._res_baseline = self._resource_counts()

        for i in range(n_steps):
            step = actions.generate_step(
                rng, self._window_count(), actions.MAX_WORKSPACES, self._monitors()
            )
            executed.append(step)
            if on_step:
                on_step(i, step)
            try:
                self.execute(step)
            except WaitTimeoutError:
                # A spawn whose window never appeared (rect 0x0 / GApplication register race,
                # or a sluggish long-running container) is a known INFRA flake, not a tree bug.
                # Drop the step and keep fuzzing rather than aborting a long session.
                executed.pop()
                continue
            except ShellProxyError as e:
                # Distinguish a real command throw (action-threw, a tree-bug finding) from a
                # spawn/close/switch_ws lifecycle/infra failure (lifecycle-threw) — m3.
                rule = "action-threw" if step.get("kind") == "action" else "lifecycle-threw"
                return FuzzFailure(rule, str(e), executed, seed, len(executed) - 1)
            # Settle + oracle. A ShellProxyError HERE (not from execute) means the shell went
            # unreachable while we were settling/reading — it almost certainly crashed ON this
            # step. Record it as shell-dead with the repro instead of letting it escape the
            # session loop (which aborted CONTINUE runs and persisted nothing). forge-cnrc.
            try:
                self._settle()
                hit = self.check_with_retry()
            except ShellProxyError as e:
                return FuzzFailure("shell-dead", str(e), executed, seed, len(executed) - 1)
            if hit:
                return FuzzFailure(hit[0], hit[1], executed, seed, len(executed) - 1)
        # Clean session: sample the leak metric for the end-of-session summary (Angle 3).
        self._res_final = self._resource_counts()
        return None

    def replay(self, steps, expect_rule=None, reset_first=True):
        """Execute a saved step list; return the (rule, detail) of the FIRST violation, else None.

        If expect_rule is given, only that rule counts as reproduction (used by the
        shrinker so an unrelated incidental violation doesn't masquerade as the target).
        """
        if reset_first:
            self._reset_workspace()
        self.log.reset()
        for step in steps:
            try:
                self.execute(step)
            except WaitTimeoutError:
                continue  # infra spawn flake — skip (see run_session)
            except ShellProxyError as e:
                # Same action-threw vs lifecycle-threw distinction as run_session (m3).
                rule = "action-threw" if step.get("kind") == "action" else "lifecycle-threw"
                if expect_rule in (None, rule):
                    return (rule, str(e))
                continue
            # Mirror run_session: a crash during settle/oracle must not escape replay (it
            # previously propagated out of ddmin's reproduces() and errored the shrink).
            try:
                self._settle()
                hit = self.check_with_retry()
            except ShellProxyError as e:
                if expect_rule in (None, "shell-dead"):
                    return ("shell-dead", str(e))
                return None  # target rule can't reproduce on a dead shell — stop this replay
            if hit and (expect_rule is None or hit[0] == expect_rule):
                return hit
            if hit and expect_rule is not None:
                # A different violation appeared; keep going — only expect_rule reproduces.
                continue
        return None

    def reproduces(self, steps, expect_rule, k=3, min_hits=1):
        """K-times replay: True if >= min_hits of k runs reproduce expect_rule.

        Default min_hits=1 is the lenient "any run trips" bar (env is not deterministic);
        the shrinker passes a majority threshold for its DROP decision so a single flaky
        hit can't justify discarding a needed step (m6).
        """
        hits = 0
        for _ in range(k):
            hit = self.replay(steps, expect_rule=expect_rule)
            if hit and hit[0] == expect_rule:
                hits += 1
                if hits >= min_hits:
                    return True
        return False

    def _reset_workspace(self):
        """Drain EVERY workspace and revert persisted side-effects to a clean ws0 baseline.

        switch_ws chaos strands windows on other workspaces, so closing only ws0 leaves
        residue the next session inherits (M2). drain_all_windows sweeps every workspace
        without activation games (forge-4b6: shared with conftest's clean_workspace so the
        suite-level teardown drains the same way), then return to ws0. Finally revert
        GapSize/float side-effects so the oracle baseline (gap, overrides) matches self.gap.
        """
        drain_all_windows(self.shell)
        try:
            self.shell.activate_workspace(0)
        except Exception:  # noqa: BLE001
            pass
        # Revert persisted chaos so later sessions start from the oracle baseline. The gap
        # reset is exact; the float reset is best-effort — remove_class_float_override only
        # strips CLASS-WIDE overrides, so per-instance (wmId) entries left by FloatToggle are
        # not cleared (no helper exists for that; they reference dead wmIds so they're inert).
        try:
            self.shell.set_window_gap(self.gap)
        except Exception:  # noqa: BLE001
            pass
        for app in APP_PALETTE:
            # Clear class-wide float overrides for EVERY palette class (Angle 2) — FloatClassToggle
            # can now target any spawned class, so a session that floats one must not bleed the rule
            # into the next. Best-effort, same caveat as before (per-instance wmId entries are inert).
            try:
                self.shell.remove_class_float_override(app)
            except Exception:  # noqa: BLE001
                pass
        try:
            # WorkspaceActiveTileToggle persists which workspaces are floated; clear it so the
            # next session starts fully tiled (forge-cnrc).
            self.shell.set_workspace_skip_tile("")
        except Exception:  # noqa: BLE001
            pass
        try:
            # ShowTabDecorationToggle persists showtab-decoration-enabled; restore the default
            # (True) so decorations stay active for the next session's coverage (forge-cnrc).
            self.shell.set_showtab_decoration(True)
        except Exception:  # noqa: BLE001
            pass
        try:
            # TilingModeToggle persists tiling-mode-enabled; restore True so tiling is active for
            # the next session (else all windows float and tiling coverage is lost) (forge-cnrc).
            self.shell.set_tiling_mode(True)
        except Exception:  # noqa: BLE001
            pass
        try:
            # FocusBorderToggle persists focus-border-toggle; restore the default (True) so later
            # focus/split-border assertions aren't broken by a leaked toggle (forge-4b6).
            self.shell.set_focus_border(True)
        except Exception:  # noqa: BLE001
            pass
        if self.auto_split is not None:
            try:
                # Pin auto-split for the whole band (ON auto-nests new windows into deep trees,
                # OFF appends flat) so the run consistently exercises one nesting mode (forge-cnrc).
                self.shell.set_auto_split(bool(self.auto_split))
            except Exception:  # noqa: BLE001
                pass
        try:
            # LayoutStackedToggle / WorkspaceMonocleToggle on a FLAT workspace stamp STACKED/TABBED
            # onto the MONITOR (or WORKSPACE) node itself (command.js:327); that persists in the
            # tree and bleeds into the next seed in a CONTINUE run. Revert to the natural split.
            self.shell.fuzz_reset_node_layouts()
        except Exception:  # noqa: BLE001
            pass
        self._settle()

    def persist(self, failure, suffix=""):
        """Write a repro JSON; return its path."""
        self.results_dir.mkdir(parents=True, exist_ok=True)
        path = self.results_dir / ("repro-%s%s.json" % (failure.seed, suffix))
        path.write_text(json.dumps(failure.to_dict(), indent=2))
        return path


# _settle() backpressure poll: max wait for async finalizers (fuzz_pending_work busy) to drain,
# and the poll interval. Kept short so a stuck/missing signal degrades to the old behavior fast.
SETTLE_DRAIN_TIMEOUT = 2.0
SETTLE_DRAIN_INTERVAL = 0.1
