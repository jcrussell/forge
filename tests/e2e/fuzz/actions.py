"""Fuzzable action model (forge-cnrc).

A *step* is a fully-concrete, JSON-serializable dict describing one thing to do — no
RNG is consulted at execution/replay time, so a saved step list replays
deterministically (modulo the shell's own nondeterminism). The generator below is the
ONLY place randomness enters; it draws concrete params up front and bakes them into
the step.

Step shapes::

    {"kind": "action", "name": "Focus", "params": {"direction": "Left"},
     "focus": "leftmost", "also_activate": false}
    {"kind": "spawn"}
    {"kind": "close"}
    {"kind": "switch_ws", "index": 1}

Action names/params mirror the D-Bus dispatch surface (lib/extension/command.js) and
the kwargs the keybinding callbacks pass (see input_simulator.py). We route everything
through ShellProxy.invoke_forge_action (D-Bus), which dodges the synthetic-key
tile-snap latch (forge-3xz).
"""

from __future__ import annotations

from framework.constants import APP_PALETTE, DEFAULT_TEST_APP

# Geometry-based focus hints understood by bridge.invokeForgeAction. Using a
# positional hint (rather than None -> "whatever the shell focused") is what makes a
# replayed step target the same window across runs.
FOCUS_HINTS = ["leftmost", "rightmost", "topmost", "bottommost"]

DIRECTIONS = ["Left", "Right", "Up", "Down"]

# Mirror of DEFAULT_FLOAT_LAYOUT (input_simulator.py:28 / keybindings.js) so the float
# toggle produces the same geometry as the real keybinding.
DEFAULT_FLOAT_LAYOUT = {
    "mode": "float",
    "x": "center",
    "y": "center",
    "width": 0.65,
    "height": 0.75,
}

# Cap on concurrent windows: spawning is ~10s each (and can hit the Mutter 50
# GApplication 25s register race, conftest.py), so keep the working set small and the
# spawn weight low.
MAX_WINDOWS = 8
MIN_WINDOWS = 1
MAX_WORKSPACES = 3


def _action(name, weight, build):
    return {"name": name, "weight": weight, "build": build}


# Each builder takes the RNG and returns the step's params dict. also_activate is set
# per-action below (resize must genuinely focus its target — forge-2n0).
TILING_ACTIONS = [
    # Weights rebalanced toward STRUCTURE (forge-cnrc depth review): Split raised, pure-geometry/
    # focus no-ops trimmed, so more steps deepen/mutate the tree instead of nudging geometry.
    _action("Focus", 3, lambda r: {"direction": r.choice(DIRECTIONS)}),
    _action("Move", 5, lambda r: {"direction": r.choice(DIRECTIONS)}),
    _action("Swap", 5, lambda r: {"direction": r.choice(DIRECTIONS)}),
    _action("FocusNext", 1, lambda r: {}),
    _action("FocusPrev", 1, lambda r: {}),
    _action("SwapNext", 2, lambda r: {}),
    _action("SwapPrev", 2, lambda r: {}),
    _action("WindowSwapLastActive", 2, lambda r: {}),
    _action("Split", 8, lambda r: {"orientation": r.choice(["horizontal", "vertical"])}),
    _action("LayoutToggle", 4, lambda r: {}),
    _action("LayoutStackedToggle", 3, lambda r: {}),
    _action("LayoutTabbedToggle", 3, lambda r: {}),
    _action("WindowResizeLeft", 1, lambda r: {"amount": r.choice([40, 80, 120])}),
    _action("WindowResizeRight", 1, lambda r: {"amount": r.choice([40, 80, 120])}),
    _action("WindowResizeTop", 1, lambda r: {"amount": r.choice([40, 80, 120])}),
    _action("WindowResizeBottom", 1, lambda r: {"amount": r.choice([40, 80, 120])}),
    _action("WindowExpand", 2, lambda r: {"amount": r.choice([40, 80])}),
    _action("WindowShrink", 2, lambda r: {"amount": r.choice([40, 80])}),
    _action("WindowGoldenRatio", 1, lambda r: {}),
    _action("WindowResetSizes", 1, lambda r: {}),
    _action(
        "SnapLayoutMove",
        3,
        lambda r: {
            "direction": r.choice(["Left", "Right", "Center"]),
            "amount": r.choice([0.33, 0.5, 0.66]),
        },
    ),
    _action("GapSize", 2, lambda r: {"amount": r.choice([2, 4, -2, -4])}),
    _action("FloatToggle", 3, lambda r: dict(DEFAULT_FLOAT_LAYOUT)),
    _action("FloatNonPersistentToggle", 2, lambda r: dict(DEFAULT_FLOAT_LAYOUT)),
    # Workspace-level toggles (forge-cnrc): wholesale state churn across the WHOLE active
    # workspace, not a single window — float/unfloat every window (ActiveTileToggle) or flip
    # the monocle layout (MonocleToggle). Exercises mass float/decoration/tree-rebuild paths
    # the per-window actions never hit. No params; focus is irrelevant (they act on the active
    # workspace). ActiveTileToggle persists `workspace-skip-tile` → reset in _reset_workspace.
    _action("WorkspaceActiveTileToggle", 2, lambda r: {}),
    _action("WorkspaceMonocleToggle", 2, lambda r: {}),
    # TilingModeToggle flips tiling-mode-enabled GLOBALLY: floatAllWindows()/unfloatAllWindows()
    # across every workspace while preserving the tree (forge-cnrc). Biggest mass float/unfloat
    # churn available — reset tiling-mode-enabled to its True default in _reset_workspace, else a
    # session left "off" floats all subsequent windows and suppresses tiling coverage.
    _action("TilingModeToggle", 2, lambda r: {}),
    # Misc command toggles (forge-cnrc): global decoration/config churn distinct from the
    # per-window ops. ShowTabDecorationToggle flips showtab-decoration-enabled (mass
    # create/destroy of tab decorations — the lifecycle area of forge-bomy/v2yz; reset to the
    # `true` default in _reset_workspace). FloatClassToggle mass-floats by window class (shares
    # the float-toggle body, so it needs the float layout). ConfigReload re-reads windows.json +
    # reimports config (the reload/re-apply path).
    _action("ShowTabDecorationToggle", 3, lambda r: {}),
    _action("FloatClassToggle", 2, lambda r: dict(DEFAULT_FLOAT_LAYOUT)),
    _action("ConfigReload", 1, lambda r: {}),
    # Remaining keybinding-dispatched commands, added for full keybinding coverage (forge-cnrc).
    # Low value (cosmetic/pointer/config-export) but cheap and real bound actions. FocusBorderToggle
    # flips the focus-border display; MovePointerToFocus warps the pointer to the focus; ConfigExport
    # enables portable config (writes files — ephemeral container). PrefsOpen is deliberately NOT
    # fuzzed: it launches the external GTK4 prefs window, which is not a tiling action and risks
    # hanging/noise headless.
    _action("FocusBorderToggle", 1, lambda r: {}),
    _action("MovePointerToFocus", 1, lambda r: {}),
    _action("ConfigExport", 1, lambda r: {}),
]

# Actions whose async finalize re-reads real focus (resize/expand/shrink): must
# genuinely activate the positional target, not just override get_focus_window.
_ALSO_ACTIVATE = {
    "WindowResizeLeft",
    "WindowResizeRight",
    "WindowResizeTop",
    "WindowResizeBottom",
    "WindowExpand",
    "WindowShrink",
}

_ACTION_TOTAL_WEIGHT = sum(a["weight"] for a in TILING_ACTIONS)

# Lifecycle-chaos weights (low — see MAX_WINDOWS note). Tuned so the working set
# churns without collapsing to empty or thrashing on slow spawns.
SPAWN_WEIGHT = 4
CLOSE_WEIGHT = 3
SWITCH_WS_WEIGHT = 2

# Window-state class (forge-cnrc): raw Meta.Window state ops (NOT Forge commands) that make a
# window leave/rejoin the tile tree (minimize) or trigger fullscreen float-demotion. Both states
# are oracle-safe (skipped in the overlap check). See bridge.fuzzWindowState.
WINSTATE_OPS = ["minimize", "unminimize", "fullscreen", "unfullscreen", "maximize", "unmaximize"]
# Trimmed from 8 (forge-cnrc depth review): minimize/fullscreen/maximize REMOVE windows from the
# tiled tree, hollowing already-shallow trees — keep it exercised but less dominant.
WINSTATE_WEIGHT = 4

# Drag-drop tile class (forge-cnrc): drag one window onto a ZONE of another, exercising Forge's
# drop/reparent logic (moveWindowToPointer) — the one feature real keybindings can't reach. Needs
# >=2 windows. Zones map to drop regions: center=stack/tab into target, edges=split. See bridge.fuzzDrag.
DRAG_ZONES = ["center", "left", "right", "top", "bottom"]
DRAG_WEIGHT = 6

# Drag-PATH class (forge-v9o7): same drop surface as DRAG, but walks the REAL grab loop through
# 2-3 intermediate window centers (vias) before the TGT zone, exercising the preview-hint
# lifecycle + live-preview branch _handleMoving runs that single-point fuzz_drag bypasses.
DRAG_PATH_WEIGHT = 4

# Re-home class (forge-v9o7, partial-multimon): move the focused window to the current monitor
# (in-range) or one PAST the last monitor. NB: Mutter's move_to_monitor ABORTS the shell on an
# out-of-range index (uncatchable libmutter assertion, GNOME 49.6), so the bridge wrapper
# range-guards it (returns OUT_OF_RANGE) — out-of-range exercises that guard, in-range exercises
# the real reparent. Single-monitor-reachable; true dual-display stays deferred (forge-leqs/62ja).
REHOME_WEIGHT = 2


# App palette as a weighted (name, weight) list for the spawn step (Angle 2). Drawn heavily
# toward DEFAULT_TEST_APP (the fast/reliable tiled editor); the minority entry (zenity) is a
# dialog/transient probe. Baked into the step as a tag so replay re-spawns the same app.
_SPAWN_APPS = [(name, spec["weight"]) for name, spec in APP_PALETTE.items()]


def _weighted_choice(rng, items, weight_key):
    total = sum(weight_key(i) for i in items)
    pick = rng.uniform(0, total)
    upto = 0.0
    for i in items:
        upto += weight_key(i)
        if pick <= upto:
            return i
    return items[-1]


# --- single-step builders -----------------------------------------------------------------------
# One concrete step each, drawing ONLY from the passed rng (see module docstring: the generator is
# the only place randomness enters). Extracted so the hazard sequences below can COMPOSE the very
# same primitives generate_step emits — no new step kinds, no new bridge/shell surface (forge-fhen.9).


def _spawn_step(rng):
    return {"kind": "spawn", "app": _weighted_choice(rng, _SPAWN_APPS, lambda a: a[1])[0]}


def _close_step():
    return {"kind": "close"}


def _switch_ws_step(rng):
    return {"kind": "switch_ws", "index": rng.randint(0, MAX_WORKSPACES - 1)}


def _drag_step(rng):
    return {
        "kind": "drag",
        "src": rng.choice(FOCUS_HINTS),
        "tgt": rng.choice(FOCUS_HINTS),
        "zone": rng.choice(DRAG_ZONES),
    }


def _drag_path_step(rng):
    return {
        "kind": "drag_path",
        "src": rng.choice(FOCUS_HINTS),
        "tgt": rng.choice(FOCUS_HINTS),
        "zone": rng.choice(DRAG_ZONES),
        # 2-3 intermediate waypoints drawn from the same positional hints; resolved to
        # window centers JS-side, so the step stays JSON-serializable + replay-stable.
        "vias": [rng.choice(FOCUS_HINTS) for _ in range(rng.randint(2, 3))],
    }


def _action_step(rng):
    a = _weighted_choice(rng, TILING_ACTIONS, lambda x: x["weight"])
    return {
        "kind": "action",
        "name": a["name"],
        "params": a["build"](rng),
        "focus": rng.choice(FOCUS_HINTS),
        "also_activate": a["name"] in _ALSO_ACTIVATE,
    }


# --- hazard sequences (forge-fhen.9) ------------------------------------------------------------
# Higher-level ORDERINGS composed from the EXISTING single-step primitives above, biased to place a
# disposal-sensitive operation IMMEDIATELY ADJACENT to the operation that created/grabbed the actor:
# spawn->close of the just-tiled focused window, drag/drag_path->close of the just-reparented target,
# spawn/action->switch_ws before a relayout fully settles, and workspace-switch churn interleaved
# with a tiling mutation. Uniform random generation almost never produces these adjacencies; biasing
# toward them widens coverage of the actor-use-after-dispose / event-ordering transitions (the ~60%
# runtime half static analysis cannot reach). generate_step FLATTENS a sequence into its sub-steps, so
# each sub-step still runs through the engine's _settle()+full oracle (structure/geometry/preview-hint/
# focus/log scan) — a sequence only CONCENTRATES adjacency, it never removes or weakens a check.
#
# Each builder draws only from rng and is net window-count-safe: gating (below) uses the window count
# at sequence START and every sequence keeps the working set within [MIN_WINDOWS, MAX_WINDOWS].
DEFAULT_HAZARD_WEIGHT = 0  # OFF by default: existing seeds/CI stay byte-identical (see FuzzEngine).


def _hz_spawn_close(rng):
    # Rapid spawn -> immediate close of the just-spawned focused window: back-to-back
    # create/dispose of a freshly tiled node.
    return [_spawn_step(rng), _close_step()]


def _hz_drag_close(rng):
    # Reparent one window onto another (drop/reparent), then immediately close the focused
    # target: dispose right after a tree reparent.
    return [_drag_step(rng), _close_step()]


def _hz_dragpath_close(rng):
    # Same, but through the REAL grab loop (preview-hint lifecycle) before the dispose.
    return [_drag_path_step(rng), _close_step()]


def _hz_action_switch(rng):
    # A tiling mutation immediately followed by a workspace switch: the relayout of ws N is
    # adjacent to the activation/teardown of another workspace.
    return [_action_step(rng), _switch_ws_step(rng)]


def _hz_spawn_switch(rng):
    # Spawn then immediately switch workspace before the new window finishes tiling.
    return [_spawn_step(rng), _switch_ws_step(rng)]


def _hz_ws_churn(rng):
    # Rapid workspace-switch churn with a tiling action mid-churn (windows tiled while switching).
    return [_switch_ws_step(rng), _action_step(rng), _switch_ws_step(rng)]


# (name, weight, eligible(window_count), build(rng)). eligible gates on the START window count and
# each sequence is net-safe within [MIN_WINDOWS, MAX_WINDOWS]:
#   *_close removes one window  -> need >= 2 (so the result stays >= MIN_WINDOWS=1)
#   spawn_*   adds one window   -> need <  MAX_WINDOWS
# spawn_close closes AND spawns: it needs wc >= 2, not just wc < MAX_WINDOWS. If the spawn sub-step
# flakes (WaitTimeoutError -> run_session pops it and still runs the paired close), the close falls
# on the START working set, so wc must be >= 2 for the result to stay >= MIN_WINDOWS=1.
_HAZARDS = [
    ("spawn_close", 3, lambda wc: 2 <= wc < MAX_WINDOWS, _hz_spawn_close),
    ("drag_close", 3, lambda wc: wc >= 2, _hz_drag_close),
    ("dragpath_close", 2, lambda wc: wc >= 2, _hz_dragpath_close),
    ("action_switch", 3, lambda wc: wc >= 1, _hz_action_switch),
    ("spawn_switch", 2, lambda wc: wc < MAX_WINDOWS, _hz_spawn_switch),
    ("ws_churn", 2, lambda wc: wc >= 1, _hz_ws_churn),
]


def generate_step(rng, window_count, workspace_count, monitor_count=1, hazard_weight=0):
    """Produce one concrete step (or a hazard SEQUENCE), gating chaos on window/workspace state.

    window_count is the number of windows on the active workspace; chaos actions are
    only offered when they keep the working set within [MIN_WINDOWS, MAX_WINDOWS].

    Returns a single step dict, OR — when hazard_weight>0 and the "hazard" category is drawn — a
    LIST of concrete step dicts (a hazard sequence, forge-fhen.9). The caller flattens the list and
    runs each sub-step through the normal settle+oracle path, so the saved repro stays a flat step
    list. hazard_weight defaults to 0: the "hazard" entry is then never even added to the menu, so
    the rng draw sequence (and every generated session) is byte-identical to the pre-hazard behavior.
    """
    # Build the menu of available step categories with weights, gated by state.
    menu = [("action", _ACTION_TOTAL_WEIGHT)]
    if window_count < MAX_WINDOWS:
        menu.append(("spawn", SPAWN_WEIGHT))
    if window_count > MIN_WINDOWS:
        menu.append(("close", CLOSE_WEIGHT))
    menu.append(("switch_ws", SWITCH_WS_WEIGHT))
    if window_count >= 1:
        menu.append(("winstate", WINSTATE_WEIGHT))
    if window_count >= 2:
        menu.append(("drag", DRAG_WEIGHT))
    if window_count >= 2:
        menu.append(("drag_path", DRAG_PATH_WEIGHT))
    if window_count >= 1:
        menu.append(("rehome", REHOME_WEIGHT))
    # forge-fhen.9: only offered when explicitly enabled (default 0 -> entry absent -> identical rng
    # draws + identical sessions). Appended LAST so, when present, it never reorders existing entries.
    if hazard_weight > 0 and window_count >= 1:
        menu.append(("hazard", hazard_weight))

    kind = _weighted_choice(rng, menu, lambda m: m[1])[0]

    if kind == "spawn":
        # Tag the spawn with a palette app so it exercises class/type diversity and replays
        # the same app. Default-weighted toward the editor (see _SPAWN_APPS).
        return _spawn_step(rng)
    if kind == "close":
        return _close_step()
    if kind == "switch_ws":
        return _switch_ws_step(rng)
    if kind == "winstate":
        return {
            "kind": "winstate",
            "op": rng.choice(WINSTATE_OPS),
            "focus": rng.choice(FOCUS_HINTS),
        }
    if kind == "drag":
        return _drag_step(rng)
    if kind == "drag_path":
        return _drag_path_step(rng)
    if kind == "rehome":
        # In-range (current/any monitor) or one-past-the-end (forces clamp/guard).
        in_range = rng.randrange(max(1, monitor_count))
        out_range = monitor_count + rng.randint(1, 3)
        return {"kind": "rehome", "monitor": rng.choice([in_range, out_range])}
    if kind == "hazard":
        # Pick an eligible hazard sequence by weight; return its flat list of sub-steps. Defensive
        # fallback (unreachable while window_count>=1, since action_switch/ws_churn are always
        # eligible): degrade to a single action so the generator never returns an empty sequence.
        eligible = [h for h in _HAZARDS if h[1] > 0 and h[2](window_count)]
        if not eligible:
            return _action_step(rng)
        return _weighted_choice(rng, eligible, lambda h: h[1])[3](rng)

    return _action_step(rng)


def describe(step):
    """One-line human label for a step (for logs / repro summaries)."""
    kind = step.get("kind")
    if kind == "spawn":
        return "spawn(%s)" % (step.get("app") or DEFAULT_TEST_APP)
    if kind == "action":
        params = step.get("params") or {}
        ps = ",".join("%s=%s" % (k, v) for k, v in params.items())
        return "%s(%s)@%s" % (step["name"], ps, step.get("focus"))
    if kind == "switch_ws":
        return "switch_ws(%s)" % step.get("index")
    if kind == "winstate":
        return "winstate:%s@%s" % (step.get("op"), step.get("focus"))
    if kind == "drag":
        return "drag(%s->%s:%s)" % (step.get("src"), step.get("tgt"), step.get("zone"))
    if kind == "drag_path":
        return "drag_path(%s->%s:%s via %s)" % (
            step.get("src"),
            step.get("tgt"),
            step.get("zone"),
            step.get("vias"),
        )
    if kind == "rehome":
        return "rehome(mon=%s)" % step.get("monitor")
    return kind
