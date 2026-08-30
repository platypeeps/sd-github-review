# Review Usage Reconciliation Contract Design

## Boundary

This child begins with an authorized reservation and a bounded reviewer outcome.
It defines monotonic accounting of actual usage/cost, overrun, unknown state,
and unused reserve. It does not select candidates or recover deferred reviews.

Budget classification is independent from content outcome. A completed review
may coexist with `budget_overrun` when all hard request limits were honored. A
hard-limit breach is `policy_violation`; it cannot satisfy review assurance and
requires candidate quarantine. In both cases, reconciliation debits the full
authoritative actual usage and may leave the pool `overdrawn`.

Reconciliation is idempotent on authorization identity. Later provider evidence
may resolve an explicit unknown according to retention policy, but conflicting
final facts fail visibly and cannot affect another attempt.

`standard-v1` keeps terminal reconciliation detail for 90 days, forces
unresolved reconciliation to `expired_unknown` at 180 days, and retains the
bounded receipt/audit for 13 months. Expiry preserves explicit unknown and
coverage state rather than manufacturing final usage.

## Rollback

Configuration rollback does not rewrite reconciled ledger history. Failed or
delayed reconciliation remains auditable and retryable through the same key.
