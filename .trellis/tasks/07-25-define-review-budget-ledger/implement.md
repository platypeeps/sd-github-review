# Review Budget Ledger Contract Plan

1. Define observe/reserve request, response, lease, and pool schemas.
2. Build deterministic in-memory independent/shared-pool behavior.
3. Add maximum-cost preflight, units, hard-limit, freshness, safety-margin,
   replay, contention, overdrawn, recovery, and expiry fixtures.
4. Add fake-clock 90/180-day lifecycle, 13-month receipt, hold, purge, backup,
   and coverage fixtures.
5. Document private persistence, isolation, and provider-observation limits.
6. Export a conformance suite for the future private implementation.

Validate atomic internal decisions, no partial mutation, bounded failures,
cross-tenant rejection, and credential-free public responses.
