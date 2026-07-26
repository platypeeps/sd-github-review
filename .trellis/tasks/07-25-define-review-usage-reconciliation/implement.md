# Review Usage Reconciliation Contract Plan

1. Define reconciliation and release schemas and monotonic state rules.
2. Extend the in-memory fake for exact, partial, soft overrun, hard violation,
   overdrawn, zero, and unknown use.
3. Add quarantine, recovery, delayed, duplicate, conflicting, expired, and
   ambiguous fixtures.
4. Add fake-clock 90/180-day lifecycle, 13-month receipt, hold, purge, backup,
   and coverage fixtures.
5. Add bounded audit and privacy/retention semantics.
6. Publish conformance expectations for private implementation.

Validate pool isolation, idempotence, release-only-when-proven, unknown-cost
preservation, full-actual debit, soft/hard classification, quarantine,
overdrawn blocking, and credential-free evidence.
