# Deferred Review Recovery Contract Plan

1. Define defer/list/recover/supersede/expire/delete schemas and states.
2. Extend the in-memory fake with tenant and exact-head authorization.
3. Add fake-clock duplicate, changed-head, closed-PR, ambiguity, exact 180-day
   `expired_unreviewed`, 30-day terminal detail, compaction, and deletion cases.
4. Add legal hold, purge, removal/transfer, backup expiry, bounded status, and
   coverage fixtures from `standard-v1`.
5. Add public status references and privacy/retention documentation.
6. Add immutable receipt, projection revision/CAS, same-head recovery,
   changed-head supersession, and late-write rejection fixtures.
7. Export conformance fixtures for private implementation and future commands.

Validate explicit-only recovery, idempotent attempts, cross-tenant rejection,
no prompt reconstruction, clear deferred-versus-completed assurance, and
deterministic latest-head projection ownership.
