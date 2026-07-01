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


def generate_step(rng, window_count, workspace_count, monitor_count=1):
    """Produce one concrete step, gating chaos on the current window/workspace state.

    window_count is the number of windows on the active workspace; chaos actions are
    only offered when they keep the working set within [MIN_WINDOWS, MAX_WINDOWS].
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

    kind = _weighted_choice(rng, menu, lambda m: m[1])[0]

    if kind == "spawn":
        # Tag the spawn with a palette app so it exercises class/type diversity and replays
        # the same app. Default-weighted toward the editor (see _SPAWN_APPS).
        return {"kind": "spawn", "app": _weighted_choice(rng, _SPAWN_APPS, lambda a: a[1])[0]}
    if kind == "close":
        return {"kind": "close"}
    if kind == "switch_ws":
        return {"kind": "switch_ws", "index": rng.randint(0, MAX_WORKSPACES - 1)}
    if kind == "winstate":
        return {
            "kind": "winstate",
            "op": rng.choice(WINSTATE_OPS),
            "focus": rng.choice(FOCUS_HINTS),
        }
    if kind == "drag":
        return {
            "kind": "drag",
            "src": rng.choice(FOCUS_HINTS),
            "tgt": rng.choice(FOCUS_HINTS),
            "zone": rng.choice(DRAG_ZONES),
        }
    if kind == "drag_path":
        return {
            "kind": "drag_path",
            "src": rng.choice(FOCUS_HINTS),
            "tgt": rng.choice(FOCUS_HINTS),
            "zone": rng.choice(DRAG_ZONES),
            # 2-3 intermediate waypoints drawn from the same positional hints; resolved to
            # window centers JS-side, so the step stays JSON-serializable + replay-stable.
            "vias": [rng.choice(FOCUS_HINTS) for _ in range(rng.randint(2, 3))],
        }
    if kind == "rehome":
        # In-range (current/any monitor) or one-past-the-end (forces clamp/guard).
        in_range = rng.randrange(max(1, monitor_count))
        out_range = monitor_count + rng.randint(1, 3)
        return {"kind": "rehome", "monitor": rng.choice([in_range, out_range])}

    a = _weighted_choice(rng, TILING_ACTIONS, lambda x: x["weight"])
    return {
        "kind": "action",
        "name": a["name"],
        "params": a["build"](rng),
        "focus": rng.choice(FOCUS_HINTS),
        "also_activate": a["name"] in _ALSO_ACTIVATE,
    }


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
