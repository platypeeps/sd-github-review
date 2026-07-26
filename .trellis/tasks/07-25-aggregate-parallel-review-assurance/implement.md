# Parallel Review Assurance Aggregation Plan

1. Add child/parent state-machine and completion-formula fixtures.
2. Implement monotonic aggregate evaluation and deadline transitions.
3. Classify whether impossible assurance is caused exclusively by proven
   pre-dispatch budget exhaustion and apply the explicit merge-gate policy only
   in that case.
4. Publish stable `sd-review / assurance` and `sd-review / gate` exact-head
   projections with explicit limitations and branch-protection diagnostics.
5. Add immutable aggregate attempts, projection revision/CAS, recovery, replay,
   late-result, supersession, and rollback cases.

Validate every required/optional/minimum combination, timeout, ambiguity,
deferred assurance/gate separation, mixed hard failures, deterministic
finalization, projection ownership, and stable Check naming.
