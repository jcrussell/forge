# Bug-class hazard catalog

Forge runs inside the GNOME Shell process against Mutter's GObject-introspected
APIs, so the recurring defects cluster into a handful of **classes** rather than
one-off mistakes. A 2026-07-24 analysis of the last ~100 fixes found roughly 40%
were statically preventable and 60% were runtime hazards (GJS finalization, actor
use-after-dispose, races, Mutter version drift). The `forge-fhen` anti-regression
program built a layered set of guardrails against these classes; this file is the
canonical map of **class → guardrail → known gap**.

Each guardrail is either **blocking** (fails CI / pre-commit) or **advisory /
runtime** (surfaces the defect but does not gate a merge). Prefer adding to a
blocking layer when a class can be caught statically.

## The classes

### 1. Chained nullable-getter deref
`metaWindow.get_workspace().index()` / `get_monitor()` fed straight into a
consumer. On an **unmanaged** window `get_workspace()` returns null and
`get_monitor()` returns `-1`, so the immediate deref throws / misbehaves ("window
died between the signal and the handler" — e.g. `forge-ib39`, `forge-7bry`).

- **Guardrail (blocking):** `local/no-unguarded-window-deref` (`eslint-rules/`)
  flags the immediate-chain shape and forces the idiomatic **capture-then-guard**
  form: `const ws = win.get_workspace(); if (!ws) return;`.
- **Note on shims:** we deliberately do *not* wrap these getters. A safe-shim
  wrapper is reserved for calls that **abort the shell** and thus can't be guarded
  after the fact — see `Utils.getWorkAreaSafe` (`get_work_area_current_monitor()`
  `g_assert`s on monitor `-1`) and `Utils.getMonitorGeometrySafe`.

### 2. Finalized GObject wrapper throws on *any* method
A disposed-but-not-yet-finalized `Meta.Window` wrapper throws on **every**
accessor, not only on a null return (Bug #328). A live-looking reference obtained
before an async hop may be dead by the time the handler runs.

- **Guardrail (runtime):** `Utils.isWindowAlive()` probes with a `try/catch`
  around `get_id()`; call it before touching a window whose liveness isn't
  guaranteed by the immediate caller. `disconnectSignals()` wraps each
  `disconnect()` in `try/catch` for the same reason.
- **Guardrail (runtime):** the e2e fuzzer's log scan treats `finalized` /
  `deallocated` / `Gjs-CRITICAL` frames as failures.
- **Gap:** no static rule — many raw getters (`get_frame_rect`, `get_title`, …)
  rely on the caller's context being "known live". Hard to prove statically.

### 3. Signal connect/disconnect discipline
A handler connected to a **long-lived external** object (`global.display`,
settings, a shared actor) whose id is discarded outlives Forge's teardown and
fires after `disable()` — the classic extension leak.

- **Guardrail (blocking):** `local/no-untracked-connect` fails on a discarded
  `.connect()` id. Exempt shapes: `connectObject(...)` (auto-tracked),
  `this.connect(...)` (self-connect — freed with the instance), and
  actor-lifetime-bound connects carrying a scoped `eslint-disable` with the reason
  (a destroyed actor auto-disconnects its own handlers). **Prefs** sources are
  exempt by file scope — the prefs GTK4 process is torn down wholesale on close.
- **Gap / TODO:** three manual tracking idioms still coexist in `window.js` /
  `config-sync.js`; `forge-fhen.7` will migrate them to
  `connectObject`/`disconnectObject` (deferred pending e2e validation).

### 4. Actor use-after-destroy
Touching a Clutter/St actor (or a window's `get_compositor_private()`) after it
has been destroyed/reparented — e.g. tab teardown racing a render (`forge-v2yz`,
`forge-5r0j`, the "St.BoxLayout already disposed" family).

- **Guardrail (in-code):** null-check `get_compositor_private()` and gate
  reparenting on `global.window_group.contains(actor)` (see `decoration.js`);
  null a dangling actor ref from the actor's own `destroy` handler.
- **Guardrail (runtime):** e2e fuzzer hazard sequences (spawn/drag/close
  adjacency) + the "already disposed" log markers.

### 5. Mutter version drift
A `Meta.Window` API whose signature/availability changed across releases (most at
Mutter 49) called directly, so it crashes on the other version.

- **Guardrail (blocking):** `local/no-raw-maximize-api` bans the raw
  maximize/unmaximize APIs everywhere except `lib/extension/compat.js`, forcing
  all callers through the version-dispatch shims. Full drift map + recipe:
  [compat.md](compat.md).
- **Gap:** a few drifting calls don't yet route through `compat.js` (e.g. the
  seat lookup in `focus.js`, some `get_active_workspace*` sites). Candidates for a
  future rule/shim.

### 6. GLib source-id leaks
A `GLib.timeout_add` / `idle_add` whose id is not removed on the owning object's
teardown keeps firing against a dead object.

- **Guardrail (partial):** each owner stores its source id and removes it on
  teardown (`config-sync.js`, `focus.js`, `window.js`), but there is no shared
  helper and no static rule.
- **Gap:** no `no-untracked-timeout` rule and no central register/clear helper —
  the next site can silently reintroduce the leak. Future work.

## Cross-cutting guardrails

- **`tsc --checkJs` + `strictNullChecks`** (blocking) — null-safety on typed GNOME
  returns; catches class 1 at the type layer where the return is annotated. Needs
  the `@girs/*` ambient types (`types/ambient.d.ts`).
- **`tree.verifyIntegrity()`** (dev builds) — parent-ref / cycle / duplicate /
  empty-container invariants after tree mutations; the same rule family the e2e
  fuzzer checks, run inline on every dev render (log-and-continue).
- **Seeded e2e fuzzer** (`tests/e2e/fuzz/`) — stateless step executor with an
  oracle bundle (liveness eval, `fuzzCheckInvariants`, log scan) after every step;
  ddmin shrinker for repros. Invariant list: `tests/e2e/README.md`.
- **Coverage ratchet** (`vitest.config.js`) — a floor below the measured baseline;
  raise, never lower.
- **CSS property round-trip tests** (`tests/unit/css/roundtrip.test.js`) — seeded
  in-grammar stylesheets assert `stringify(parse(x))` is a fixed point (the
  `forge-y3jy` data-loss cluster).
- **Regression corpus** (`tests/regression/bug-*.test.js`) — one pinned test per
  historical defect.

## Adding a guardrail

When a *new* class emerges (two or more fixes sharing a shape), prefer the
cheapest blocking layer that can catch it: a `tsc` annotation, then a repo-local
ESLint rule (`eslint-rules/` + a test in `tests/unit/eslint-rules/`), then a
runtime invariant in `verifyIntegrity`/the fuzzer. Land new rules as `warn` while
burning the existing violations, then promote to `error` — the same path
`no-untracked-connect` and `no-unguarded-window-deref` took in `forge-fhen.12`.
