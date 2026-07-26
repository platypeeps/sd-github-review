# Parallel Review Budget Reservation Implementation Plan

1. Add batch request/response and independent/shared-pool fixtures.
2. Extend the in-memory control plane with atomic plan reservation.
3. Implement required/optional/minimum feasibility and chain eligibility.
4. Persist parent/child authorization and lease identities idempotently.
5. Add expiry, release, concurrency, failure, and rollback cases.

Validate no partial impossible plan, replay stability, safety margins, stale
state, concurrent exhaustion, and bounded credential-free responses.
