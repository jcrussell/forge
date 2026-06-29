"""Forge live fuzzer (forge-cnrc).

Generates seeded random sequences of user actions against a real headless GNOME
Shell and, after every step, checks a set of SOUND tree invariants (bridge
fuzzCheckInvariants), tiled-window geometry, and the live gnome-shell log for thrown
exceptions. A failing run is persisted as a replayable repro and shrunk to a minimal
sequence with ddmin (K-times replay, since the environment is not bit-deterministic).

See tests/e2e/README.md ("Fuzzing") and the plan at
.claude/plans/fuzzers-are-great-for-dazzling-puzzle.md.
"""
