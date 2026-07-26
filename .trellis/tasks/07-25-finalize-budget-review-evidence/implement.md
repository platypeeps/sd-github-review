# Budget Review Evidence Finalization Implementation Plan

1. Add model/profile acknowledgment, outcome, token-limit, soft/hard overrun,
   overdrawn, and reconciliation-link fixtures.
2. Implement model/profile provenance validation and monotonic receipt
   transitions.
3. Publish stable `sd-review / assurance` and `sd-review / gate` Checks with
   separate assurance/gate outcomes and explicit budget-deferral semantics.
4. Add bounded status, pending, explain, recovery, discovery, retention-status,
   and purge-operation projections.
5. Add policy/class/lifecycle/hold/deletion/coverage metadata and GitHub-native
   artifact exclusions.
6. Add immutable-attempt/latest-head projection revisions, same-head recovery,
   changed-head supersession, stale-write rejection, and branch-protection
   readiness diagnostics.
7. Harden replay, truncation, privacy, and historical receipt behavior.

Validate every terminal state, unknown usage, duplicate finalization, changed
head, deferred recovery linkage, content/budget/gate outcome independence,
non-budget hard blocks, prohibited fields, and public metadata gates.
