# Parallel Review Dispatch Orchestration Plan

1. Add scheduler, child identity, crash/replay, and supersession fixtures.
2. Persist complete parent/child state before scheduling.
3. Implement bounded concurrent native/external child execution.
4. Add per-child acknowledgment, timeout, ambiguity, and late observation.
5. Harden idempotence, credential isolation, and rollback behavior.

Validate two/three-plus concurrency, partial failure, restart, changed head,
duplicate prevention, immutable targets, and independent ambiguity handling.
